const { capitalize, sum, intersection, isArray, difference } = require('lodash')
const { taskLists: { normalizeFields } } = require('@/schema/normalizers')
const { indexTaskList, unindexTaskList } = require('@/cloud/search')
const TaskList = Parse.Object.extend('TaskList')

const { TASK_LIST_IN_PROGRESS_STATUSES } = require('@/schema/enums')

const getSubmissionClass = type => capitalize(type) + 'Submission'

async function getCenterOfCubes (cubeIds) {
  if (!cubeIds.length) {
    return null
  }
  const [{ longitude, latitude }] = await $query('Cube').aggregate([
    {
      $match: {
        _id: { $in: cubeIds }
      }
    },
    {
      $group: {
        _id: null,
        longitude: { $avg: { $arrayElemAt: ['$gp', 0] } },
        latitude: { $avg: { $arrayElemAt: ['$gp', 1] } }
      }
    }
  ])
  return $geopoint(latitude, longitude)
}

function getParentStatus (parent, statusCounts) {
  if (parent.get('status') === 0) { return 0 }
  if (parent.get('status') === 4.1) { return 4.1 }
  const statuses = Object.keys(statusCounts).map(parseFloat)
  // all complete
  if (Math.min(...statuses) >= 4) {
    return 4
  }
  // some are assigned, progress or complete
  if (Math.max(...statuses) >= 2) {
    return 3
  }
  // all appointed
  if (Math.max(...statuses) >= 1) {
    return 2
  }
  return 1
}

async function getStatusAndCounts ({ briefing, control, disassembly }) {
  // count how many task lists each status has
  const statuses = {}
  const counts = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    completed: 0
  }
  if (briefing) {
    counts.approvable = 0
  }
  await $query('TaskList')
    .equalTo('briefing', briefing)
    .equalTo('control', control)
    .equalTo('disassembly', disassembly)
    .select(['status', 'counts'])
    .eachBatch((taskLists) => {
      for (const taskList of taskLists) {
        const status = taskList.get('status')
        statuses[status] = (statuses[status] || 0) + 1
        const listCounts = taskList.get('counts')
        for (const key of Object.keys(counts)) {
          counts[key] += listCounts[key] || 0
        }
      }
    }, { useMasterKey: true })
  const status = getParentStatus(briefing || control || disassembly, statuses)
  return { status, counts }
}

Parse.Cloud.beforeSave(TaskList, async ({ object: taskList }) => {
  !taskList.get('status') && taskList.set('status', taskList.get('type') === 'disassembly' ? 0.1 : 0)

  const cubeIds = [...new Set(taskList.get('cubeIds') || [])]
  cubeIds.sort()

  taskList.set('cubeIds', cubeIds)
  taskList.set('cubeCount', cubeIds.length)
  taskList.set('gp', await getCenterOfCubes(cubeIds))
  taskList.set('pk', $pk(taskList))

  for (const cubeIdField of ['adminApprovedCubeIds', 'scoutAddedCubeIds', 'markedDisassembledCubeIds']) {
    taskList.get(cubeIdField) && taskList.set(cubeIdField, intersection([...new Set(taskList.get(cubeIdField))], cubeIds))
  }

  // remove markedDisassembledCubeIds from adminApprovedCubeIds
  if (taskList.get('adminApprovedCubeIds')?.length && taskList.get('markedDisassembledCubeIds')?.length) {
    taskList.set('adminApprovedCubeIds', difference(taskList.get('adminApprovedCubeIds'), taskList.get('markedDisassembledCubeIds')))
  }

  const taskType = taskList.get('type')

  const submissionClass = getSubmissionClass(taskType)
  const submissions = taskList.isNew()
    ? []
    : await $query(submissionClass).equalTo('taskList', taskList).limit(cubeIds.length).find({ useMasterKey: true })

  const statuses = {}

  // first get approvables if its a scout list
  if (taskType === 'scout') {
    const verifiedCubeIds = await $query('Cube')
      .containedIn('objectId', cubeIds)
      .notEqualTo('vAt', null)
      .notEqualTo('media', null)
      .distinct('objectId', { useMasterKey: true })
    for (const cubeId of verifiedCubeIds) {
      statuses[cubeId] = 'approvable'
    }
  }

  for (const submission of submissions) {
    const cubeId = submission.get('cube').id
    if (submission.get('status') === 'rejected') {
      statuses[cubeId] = 'rejected'
      continue
    }
    if (submission.get('form')?.notFound) {
      statuses[cubeId] = 'not_found'
      continue
    }
    if (submission.get('status') === 'pending') {
      statuses[cubeId] = 'pending'
      continue
    }
    if (submission.get('status') === 'approved') {
      statuses[cubeId] = 'approved'
      continue
    }
  }

  const markedDisassembledCubeIds = taskList.get('markedDisassembledCubeIds') || []
  for (const cubeId of markedDisassembledCubeIds) {
    statuses[cubeId] = 'approved'
  }
  const adminApprovedCubeIds = taskList.get('adminApprovedCubeIds') || []
  for (const cubeId of adminApprovedCubeIds) {
    statuses[cubeId] = 'approved'
  }

  const statusVals = Object.values(statuses)

  const counts = {
    total: cubeIds.length,
    pending: statusVals.filter(x => x === 'pending').length,
    approved: statusVals.filter(x => x === 'approved').length,
    rejected: statusVals.filter(x => x === 'rejected').length
  }
  counts.completed = parseInt(counts.pending + counts.approved)
  // should only be consist of verified cubes that were not in admin approved cube ids and not scouted
  if (taskType === 'scout') {
    counts.approvable = statusVals.filter(x => x === 'approvable').length
  }

  if (!taskList.isNew()) {
    // scout report and quota updates
    const results = {}
    if (taskType === 'scout') {
      const quota = taskList.get('quota')
      const quotas = taskList.get('quotas')
      if (quota || quotas) {
        counts.total = quota || sum(Object.values(quotas || {}))
      }

      await $query('ScoutSubmission')
        .equalTo('taskList', taskList)
        .containedIn('status', ['pending', 'approved'])
        .select('form')
        .eachBatch((submissions) => {
          for (const submission of submissions) {
            if (submission.get('form').notFound) {
              results.nf = (results.nf || 0) + 1
              continue
            }
            const media = submission.get('form').media
            results[media] = (results[media] || 0) + 1
          }
        }, { useMasterKey: true })

      // add on top media of admin approved cubes
      for (const cube of await $query('Cube')
        .containedIn('objectId', adminApprovedCubeIds)
        .limit(adminApprovedCubeIds.length)
        .select('media')
        .find({ useMasterKey: true })) {
        const media = cube.get('media')
        results[media] = (results[media] || 0) + 1
      }

      const quotasCompleted = {}
      for (const media of ['MFG', 'KVZ']) {
        quotasCompleted[media] = results[media]
      }
      if (quotas) {
        let completedQuotaCount = 0
        for (const key of Object.keys(quotas)) {
          let total = quotasCompleted[key] || 0
          const quota = quotas[key]
          total > quota && (total = quota)
          completedQuotaCount += total
        }
        counts.completed = completedQuotaCount
      }
      taskList.set({ results, quotasCompleted })
    }

    // control report
    if (taskType === 'control') {
      await $query('ControlSubmission')
        .equalTo('taskList', taskList)
        .containedIn('status', ['pending', 'approved'])
        .select('condition')
        .eachBatch((submissions) => {
          for (const submission of submissions) {
            const condition = submission.get('condition')
            results[condition] = (results[condition] || 0) + 1
          }
        }, { useMasterKey: true })

      // add on top marked-disassembled
      if (markedDisassembledCubeIds.length) {
        results.disassemled = (results.disassembled || 0) + markedDisassembledCubeIds.length
      }
      taskList.set({ results })
    }

    // control report and quota updates
    if (taskType === 'disassembly') {
      await $query('DisassemblySubmission')
        .equalTo('taskList', taskList)
        .containedIn('status', ['pending', 'approved'])
        .select('condition')
        .eachBatch((submissions) => {
          for (const submission of submissions) {
            const condition = submission.get('condition')
            results[condition] = (results[condition] || 0) + 1
          }
        }, { useMasterKey: true })

      // add on top marked-disassembled
      if (markedDisassembledCubeIds.length) {
        results.marked = (results.marked || 0) + markedDisassembledCubeIds.length
      }
      taskList.set({ results })
    }
  }
  taskList.set({ statuses, counts })

  // if archived but status is going back remove archive
  taskList.get('status') < 4 && taskList.get('archivedAt') && taskList.set('archivedAt', null)
})

Parse.Cloud.afterSave(TaskList, async ({ object: taskList, context: { audit, notifyScouts, locationCleanup } }) => {
  await indexTaskList(taskList)
  $audit(taskList, audit)
  const placeKey = taskList.get('pk')

  for (const scout of taskList.get('scouts') || []) {
    if (notifyScouts === true || notifyScouts?.includes(scout.id)) {
      await $notify({
        user: scout,
        identifier: 'task-list-assigned',
        data: { placeKey }
      })
    }
  }
  // if locationCleanup is an array, it is an array of the scoutIds of the before state of the saved task list
  // in this case we iterate over these, or all the scouts, to remove any dangling notifications in the area.
  if (locationCleanup) {
    const beforeScouts = locationCleanup === true
      ? (taskList.get('scouts') || [])
      : locationCleanup.map(id => $parsify(Parse.User, id))
    for (const scout of beforeScouts) {
      // in any case we remove all "rejected" notifications that have the task list id
      $query('Notification')
        .equalTo('user', scout)
        .equalTo('identifier', 'task-submission-rejected')
        .equalTo('data.taskListId', taskList.id)
        .each(notification => notification.destroy({ useMasterKey: true }), { useMasterKey: true })
      // then we check to see if the scout has other task lists in the location, if not we remove the "assigned" notification
      const count = await $query('TaskList')
        .equalTo('ort', taskList.get('ort'))
        .equalTo('state', taskList.get('state'))
        .equalTo('scouts', scout)
        .containedIn('status', TASK_LIST_IN_PROGRESS_STATUSES)
        .count({ useMasterKey: true })
      if (!count) {
        $query('Notification')
          .equalTo('user', scout)
          .equalTo('identifier', 'task-list-assigned')
          .equalTo('data.placeKey', placeKey)
          .each(notification => notification.destroy({ useMasterKey: true }), { useMasterKey: true })
      }
    }
  }

  // check if date or cubes changes for an active task list (and status did not change)
  if (audit?.data && taskList.get('status') >= 1) {
    const { changes, cubeChanges } = audit.data
    if ((cubeChanges || changes?.date) && !changes?.taskStatus) {
      // notify fieldwork manager about changes
      await $notify({
        usersQuery: $query(Parse.User).equalTo('permissions', 'manage-fieldwork'),
        identifier: 'active-task-list-updated',
        data: { changes, cubeChanges, taskListId: taskList.id, placeKey, status: taskList.get('status') }
      })
    }
  }

  // set auto-erledigt if approved matches total
  const { status, counts } = taskList.attributes
  if ([1, 2, 3].includes(status) && !counts.pending && counts.approved >= counts.total) {
    // if its a scout list, you can forget about the rejected forms
    if (taskList.get('type') !== 'scout' && counts.rejected) {
      return
    }
    const changes = { taskStatus: [status, 4] }
    taskList.set({ status: 4 })
    const audit = { fn: 'task-list-complete', data: { changes } }
    await taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
  }
  // Not sure if this will degrade performance
  const parent = taskList.get('briefing') || taskList.get('control') || taskList.get('disassembly')
  await parent.save(null, { useMasterKey: true, context: { syncStatus: true } })
})

Parse.Cloud.beforeFind(TaskList, async ({ query, user, master }) => {
  query.include(['briefing', 'control', 'disassembly', 'disassembly.booking', 'disassembly.contract'])
  query._include.includes('all') && query.include('submissions')
  if (master) { return }
  if (user.get('permissions')?.includes('manage-scouts')) {
    user.get('company') && query
      .equalTo('manager', user)
      .greaterThanOrEqualTo('status', 1)
  }
  if (user.get('accType') === 'scout') {
    query.equalTo('scouts', user).containedIn('status', TASK_LIST_IN_PROGRESS_STATUSES)
  }
})

Parse.Cloud.afterFind(TaskList, async ({ objects: taskLists, query }) => {
  const today = await $today()
  for (const taskList of taskLists) {
    taskList.set('parent', taskList.get('briefing') || taskList.get('control') || taskList.get('disassembly'))
    taskList.set('dueDays', moment(taskList.get('dueDate')).diff(today, 'days'))
    if (query._include.includes('submissions')) {
      const submissionClass = getSubmissionClass(taskList.get('type'))
      // TODO: Go around limit
      taskList.set('submissions', await $query(submissionClass).equalTo('taskList', taskList).limit(10000).find({ useMasterKey: true }))
    }
    if (taskList.get('type') === 'scout') {
      if (taskList.get('quotas')) {
        const quotaStatus = []
        const quotas = taskList.get('quotas')
        const quotasCompleted = taskList.get('quotasCompleted') || {}
        for (const media of Object.keys(quotas)) {
          quotaStatus.push(`${media}: ${quotasCompleted[media] || 0}/${quotas[media]}`)
        }
        taskList.set('quotaStatus', quotaStatus.join(' | '))
      }
      if (taskList.get('quota')) {
        const quota = taskList.get('quota')
        const quotasCompleted = taskList.get('quotasCompleted') || {}
        taskList.set('quotaStatus', sum(Object.values(quotasCompleted)) + '/' + quota)
      }
    }
  }
  return taskLists
})

Parse.Cloud.beforeDelete(TaskList, async ({ object: taskList, context: { notifyRemovedWithAttributes } }) => {
  // Do not allow deleting task lists with submissions
  const submissionClass = getSubmissionClass(taskList.get('type'))
  const count = await $query(submissionClass)
    .equalTo('taskList', taskList)
    .count({ useMasterKey: true })
  if (count) { throw new Error('Diese Liste wurde bereits durch den Scout bearbeitet und kann nicht gelöscht werden.') }
  await unindexTaskList(taskList)
  if (notifyRemovedWithAttributes) {
    const placeKey = taskList.get('pk')
    const status = taskList.get('status')
    const type = taskList.get('type')
    await $notify({
      usersQuery: $query(Parse.User).equalTo('permissions', 'manage-fieldwork'),
      identifier: 'active-task-list-removed',
      data: { placeKey, status, type, ...notifyRemovedWithAttributes }
    })
  }
})

Parse.Cloud.afterDelete(TaskList, $deleteAudits)

function validateScoutManagerOrFieldworkManager (taskList, user) {
  if (user.get('permissions')?.includes('manage-fieldwork')) {
    return
  }
  if (taskList.get('manager')?.id === user.id) {
    return
  }
  throw new Error('Unbefugter Zugriff')
}

async function validateAppointAssign (taskList) {
  if (!taskList.get('cubeIds').length) {
    throw new Error('Diese Liste hat keine CityCubes!')
  }
  if (!taskList.get('date') || !taskList.get('dueDate')) {
    throw new Error('Bitte setzen Sie zuerst ein Datum und Fälligkeitsdatum.')
  }
  if (taskList.get('type') === 'scout') {
    if (!taskList.get('quotas') && !taskList.get('quota')) {
      throw new Error('Bitte setzen Sie zuerst die Anzahle.')
    }
  }
  const { ort, state: { id: stateId } } = taskList.attributes
  // validate cubes
  const cubeIds = taskList.get('cubeIds') || []
  const cubes = await $query('Cube').containedIn('objectId', cubeIds).limit(cubeIds.length).find({ useMasterKey: true })
  if (!cubes.length) { throw new Error('No cubes found') }
  if (cubes.some(cube => cube.get('ort') !== ort || cube.get('state').id !== stateId)) {
    throw new Error('Es gibt CityCubes außerhalb des Einsatzortes dieser Liste.')
  }

  // reject booked cubes
  if (taskList.get('type') === 'scout') {
    for (const cube of cubes) {
      if (cube.get('order') || cube.get('futureOrder')) { throw new Error('Diese Liste hat bereits vermarkteten CityCubes.') }
    }
  }
}

// Used in marklist store component to save manual cube changes
Parse.Cloud.define('task-list-update-cubes', async ({ params: { id: taskListId, cubeIds }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('type') !== 'scout' || !taskList.get('briefing')) {
    throw new Error('CityCubes in kann nicht geändert werden.')
  }
  if (taskList.get('status')) {
    throw new Error('CityCubes in kann nicht geändert werden.')
  }
  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(taskList, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  taskList.set({ cubeIds })
  const audit = { user, fn: 'task-list-update', data: { cubeChanges } }
  return taskList.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

// used in marklists to rate selections
Parse.Cloud.define('task-list-rate-selection', async ({ params: { id: taskListId, cubeId, selectionRating }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const selectionRatings = await taskList.get('selectionRatings') || {}
  if (selectionRatings[cubeId] === selectionRating) {
    throw new Error('Selektion bereits gesetzt.')
  }
  if (selectionRating === '⚪') {
    delete selectionRatings[cubeId]
  } else {
    selectionRatings[cubeId] = selectionRating
  }
  taskList.set({ selectionRatings })
  return taskList.save(null, { useMasterKey: true })
}, $internOrAdmin)

// Used in RkFieldworkTable to display counts
Parse.Cloud.define('task-list-locations', ({ params: { parent: { className, objectId } } }) => {
  return $query('TaskList')
    .aggregate([
      { $match: { [`_p_${className.toLowerCase()}`]: className + '$' + objectId } },
      { $group: { _id: '$pk', count: { $sum: 1 } } }
    ], { useMasterKey: true })
    .then(results => results.reduce((acc, { objectId, count }) => {
      acc[objectId] = count
      return acc
    }, {}))
}, $internOrAdmin)

Parse.Cloud.define('task-list-update-manager', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status') >= 1) {
    throw new Error('Sie können den Manager nicht ändern. Bitte ziehen Sie die Ernennung zuerst zurück.')
  }
  const { managerId } = normalizeFields(params)
  if (managerId === (taskList.get('manager')?.id || null)) {
    throw new Error('Keine Änderungen')
  }
  const changes = { managerId: [taskList.get('manager')?.id, managerId] }
  taskList.set('manager', managerId ? await $getOrFail(Parse.User, managerId) : null)

  let locationCleanup
  const currentScoutIds = (taskList.get('scouts') || []).map(s => s.id)
  if (currentScoutIds.length) {
    changes.scoutIds = [currentScoutIds, []]
    locationCleanup = currentScoutIds
  }
  taskList.unset('scouts')
  const audit = { user, fn: 'task-list-update', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup } })
  return {
    data: { manager: taskList.get('manager'), scouts: taskList.get('scouts') },
    message: 'Manager gespeichert.'
  }
}, $fieldworkManager)

Parse.Cloud.define('task-list-update-scouts', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  await validateScoutManagerOrFieldworkManager(taskList, user)
  if (taskList.get('status') > 1) {
    throw new Error('Sie können die Scouts nicht ändern. Bitte ziehen Sie die Beauftragung zuerst zurück.')
  }
  const { scoutIds } = normalizeFields(params)
  const currentScoutIds = (taskList.get('scouts') || []).map(s => s.id)
  if (scoutIds === currentScoutIds) {
    throw new Error('Keine Änderungen')
  }
  const changes = { scoutIds: [currentScoutIds, scoutIds] }
  taskList.set('scouts', scoutIds ? scoutIds.map(id => $parsify(Parse.User, id)) : null)
  const audit = { user, fn: 'task-list-update', data: { changes } }
  let notifyScouts
  if (taskList.get('status') > 1) {
    notifyScouts = scoutIds.filter(scoutId => !currentScoutIds.includes(scoutId))
  }
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScouts, locationCleanup: currentScoutIds } })
  return {
    data: taskList.get('scouts'),
    message: 'Abfahrtsliste gespeichert.'
  }
}, { requireUser: true })

Parse.Cloud.define('task-list-update-quotas', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('type') !== 'scout') {
    throw new Error('Nur für Scout-Listen')
  }
  const { quota, quotas } = normalizeFields({ ...params, type: taskList.get('type') })

  const changes = $changes(taskList, { quota, quotas })
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen') }
  quota ? taskList.set({ quota }) : taskList.unset('quota')
  quotas ? taskList.set({ quotas }) : taskList.unset('quotas')

  const audit = { user, fn: 'task-list-update', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: { quota: taskList.get('quota'), quotas: taskList.get('quotas'), counts: taskList.get('counts') },
    message: 'Anzahl gespeichert.'
  }
}, $fieldworkManager)

Parse.Cloud.define('task-list-appoint', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status') !== 0.1) {
    throw new Error('Nur geplante Abfahrtsliste können ernannt werden.')
  }
  if (!taskList.get('manager')) {
    throw new Error('Bitte wählen Sie zuerst einen Manager aus.')
  }
  await validateAppointAssign(taskList)
  const changes = { taskStatus: [taskList.get('status'), 1] }
  taskList.set({ status: 1 })
  const audit = { user, fn: 'task-list-appoint', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: taskList.get('status'),
    message: 'Abfahrtslist ernennt.'
  }
}, $fieldworkManager)

Parse.Cloud.define('task-list-assign', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  await validateScoutManagerOrFieldworkManager(taskList, user)

  if (!taskList.get('manager') || taskList.get('status') !== 1) {
    throw new Error('Nur Abfahrtsliste, die einem Manager ernannt wurde, können beauftragt werden.')
  }
  if (!(taskList.get('scouts') || []).length) {
    throw new Error('Bitte wählen Sie zuerst Scouts aus.')
  }
  if (moment(taskList.get('date')).isAfter(await $today(), 'day')) {
    throw new Error(`You can assign this task only from ${moment(taskList.get('date')).format('DD.MM.YYYY')}`)
  }
  await validateAppointAssign(taskList)
  const changes = { taskStatus: [taskList.get('status'), 2] }
  taskList.set({ status: 2 })
  const audit = { user, fn: 'task-list-assign', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScouts: true } })
  return {
    data: taskList.get('status'),
    message: 'Abfahrtslist beauftragt.'
  }
}, { requireUser: true })

Parse.Cloud.define('task-list-retract', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (![1, 2, 3].includes(taskList.get('status'))) {
    throw new Error('Nur Abfahrtsliste, die sich in Ernannt, Beauftragt oder In Bearbeitung Status finden, können zurückgezogen werden.')
  }
  const audit = { user }
  let message
  if (taskList.get('status') === 1) {
    // Validate if the user is a fieldwork manager before retracting appoint
    if (!user.get('permissions')?.includes('manage-fieldwork')) { throw new Error('Unbefugter Zugriff.') }
    const changes = { taskStatus: [taskList.get('status'), 0.1] }
    audit.data = { changes }
    taskList.set({ status: 0.1 })
    audit.fn = 'task-list-retract-appoint'
    message = 'Ernennung zurückgezogen.'
  } else {
    // Validate if the user is a fieldwork manager or the manager of the list before retracting assing
    await validateScoutManagerOrFieldworkManager(taskList, user)
    const changes = { taskStatus: [taskList.get('status'), 1] }
    audit.data = { changes }
    taskList.set({ status: 1 })
    audit.fn = 'task-list-retract-assign'
    message = 'Beauftragung zurückgezogen.'
  }
  await taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
  return {
    data: taskList.get('status'),
    message
  }
}, { requireUser: true })

Parse.Cloud.define('task-list-submission-preapprove', async ({ params: { id: taskListId, cubeId, approved }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  await validateScoutManagerOrFieldworkManager(taskList, user)
  const cube = await $getOrFail('Cube', cubeId)
  if (taskList.get('type') === 'scout' && !cube.get('vAt')) {
    throw new Error('Nur verifizierte CityCubes können als gescouted markiert werden.')
  }
  let adminApprovedCubeIds = taskList.get('adminApprovedCubeIds') || []
  adminApprovedCubeIds = approved
    ? [...adminApprovedCubeIds, cubeId]
    : adminApprovedCubeIds.filter(id => id !== cubeId)

  taskList.set('adminApprovedCubeIds', [...new Set(adminApprovedCubeIds)])
  const audit = { user, fn: taskList.get('type') + '-submission-preapprove', data: { cubeId, approved } }

  // update statuses if disassembly
  if (taskList.get('disassembly')) {
    await taskList.get('disassembly').fetchWithInclude(['contract', 'booking'], { useMasterKey: true })
    const order = taskList.get('disassembly').get('order')
    const disassembly = order.get('disassembly')
    const statuses = disassembly.statuses || {}
    approved
      ? (statuses[cubeId] = 'marked')
      : (delete statuses[cubeId])
    disassembly.statuses = $cleanDict(statuses)
    await order.set({ disassembly }).save(null, { useMasterKey: true })

    // control-disassembled
    const orderKey = [order.className, order.id].join('$')
    const controlIds = await $query('Control')
      .greaterThan('status', 0)
      .equalTo(`cubeOrderKeys.${cubeId}`, orderKey)
      .distinct('objectId', { useMasterKey: true })
    if (!controlIds) { return }
    approved
      ? await $query('TaskList')
        .equalTo('type', 'control')
        .matchesQuery('control', $query('Control').containedIn('objectId', controlIds))
        .equalTo('cubeIds', cubeId)
        .equalTo(`statuses.${cubeId}`, null) // no activity yet
        .each(async (list) => {
          const markedDisassembledCubeIds = list.get('markedDisassembledCubeIds') || []
          markedDisassembledCubeIds.push(cubeId)
          list.set('markedDisassembledCubeIds', markedDisassembledCubeIds)
          await list.save(null, { useMasterKey: true, context: { audit } })
        }, { useMasterKey: true })
      : await $query('TaskList')
        .equalTo('type', 'control')
        .matchesQuery('control', $query('Control').containedIn('objectId', controlIds))
        .equalTo('cubeIds', cubeId)
        .equalTo('markedDisassembledCubeIds', cubeId)
        .each(async (list) => {
          const markedDisassembledCubeIds = list.get('markedDisassembledCubeIds') || []
          list.set('markedDisassembledCubeIds', markedDisassembledCubeIds.filter(id => id !== cubeId))
          await list.save(null, { useMasterKey: true, context: { audit } })
        }, { useMasterKey: true })
  }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('task-list-archive', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (!taskList.get('status')) { throw new Error('Draft task lists cannot be archived') }
  const audit = { fn: 'task-list-archive', user }
  await taskList.set('archivedAt', new Date()).save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Abfahrtsliste archiviert.' }
}, $fieldworkManager)

Parse.Cloud.define('task-list-unarchive', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (!taskList.get('archivedAt')) { throw new Error('Already unarchived') }
  const audit = { fn: 'task-list-unarchive', user }
  await taskList.unset('archivedAt').save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Abfahrtsliste unarchiviert.' }
}, $fieldworkManager)

Parse.Cloud.define('task-list-remove', async ({ params: { id: taskListId } }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status')) { throw new Error('Only draft lists can be removed.') }
  await taskList.destroy({ useMasterKey: true })
  return { message: 'Abfahrtsliste gelöscht.' }
}, $fieldworkManager)

// check if location has tasks remaining
Parse.Cloud.define('task-list-mark-complete', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const changes = { taskStatus: [taskList.get('status'), 4.1] }
  taskList.set({ status: 4.1 })
  const audit = { user, fn: 'task-list-mark-complete', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
  return {
    data: taskList.get('status'),
    message: 'Liste als erledigt markiert.'
  }
}, $fieldworkManager)

// unmark complete
Parse.Cloud.define('task-list-unmark-complete', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status') < 4) { throw new Error('Liste nicht als erledigt markiert.') }
  const changes = { taskStatus: [taskList.get('status'), 0.1] }
  taskList.set({ status: 0.1 })
  const audit = { user, fn: 'task-list-unmark-complete', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: taskList.get('status'),
    message: 'Markierung erledigt zurückgezogen.'
  }
}, $fieldworkManager)

async function getQueryFromSelection (selection, count, user) {
  const query = $query(TaskList)
  if (isArray(selection)) {
    query.containedIn('objectId', selection)
    return query
  }

  if (user && user.get('accType') === 'partner') {
    selection.managerId = user.id
    query.greaterThanOrEqualTo('status', 1)
  }

  // parent
  selection.briefing && query.equalTo('briefing', $parsify('Briefing', selection.briefing))
  selection.control && query.equalTo('control', $parsify('Control', selection.control))
  // selection.assembly && query.equalTo('assembly', $parsify('Assembly', selection.assembly))
  selection.disassembly && query.equalTo('disassembly', $parsify('Disassembly', selection.disassembly))

  selection.state && query.equalTo('state', $parsify('State', selection.state))
  selection.type && query.equalTo('type', selection.type)

  selection.start && query.greaterThanOrEqualTo('date', selection.start)
  selection.end && query.lessThanOrEqualTo('date', selection.end)

  if (selection.managerId) {
    if (selection.managerId === 'none') {
      query.equalTo('manager', null)
    } else if (selection.managerId === 'any') {
      query.notEqualTo('manager', null)
    } else {
      query.equalTo('manager', $parsify(Parse.User, selection.managerId))
    }
  }
  if (selection.scoutId) {
    if (selection.scoutId === 'none') {
      query.equalTo('scouts', null)
    } else if (selection.scoutId === 'any') {
      query.notEqualTo('scouts', null)
    } else {
      query.equalTo('scouts', $parsify(Parse.User, selection.scoutId))
    }
  }
  // hide drafts if not included in status filter explicity
  if (selection.status) {
    const status = selection.status.split(',').filter(Boolean).map(parseFloat)
    status.includes(4) && status.push(4.1)
    query.containedIn('status', status)
  } else {
    query.greaterThan('status', 0)
  }

  selection.sa !== true && query.equalTo('archivedAt', null)

  const queryCount = await query.count({ useMasterKey: true })
  if (count !== queryCount) {
    throw new Error(`Count mismatch should ${count} !== was ${queryCount}`)
  }
  return query
}

// mass updates
Parse.Cloud.define('task-list-mass-update-preview', async ({ params: { selection, count }, user }) => {
  const query = await getQueryFromSelection(selection, count, user)
  const today = await $today()
  // return different previews based on action
  const response = {
    statuses: {},
    managers: {},
    scouts: {},
    future: 0,
    quotasIncomplete: 0
  }
  await query
    .select('type', 'manager', 'scouts', 'status', 'statuses', 'date', 'quota', 'quotas')
    .eachBatch((taskLists) => {
      for (const taskList of taskLists) {
        response.statuses[taskList.get('status') || 0] = (response.statuses[taskList.get('status')] || 0) + 1
        response.managers[taskList.get('manager')?.id || 'none'] = (response.managers[taskList.get('manager')?.id || 'none'] || 0) + 1
        const scouts = taskList.get('scouts') || []
        if (!scouts.length) {
          response.scouts.none = (response.scouts.none || 0) + 1
        }
        for (const scout of scouts) {
          response.scouts[scout.id] = (response.scouts[scout.id] || 0) + 1
        }
        if (taskList.get('type') === 'scout' && !taskList.get('quotas') && !taskList.get('quota')) {
          response.quotasIncomplete++
        }
        if (taskList.get('date') > today) {
          response.future++
        }
      }
    }, { useMasterKey: true })
  return response
}, { requireUser: true })

Parse.Cloud.define('task-list-mass-update-run', async ({ params: { action, selection, count, ...form }, user }) => {
  const query = await getQueryFromSelection(selection, count, user)
  const today = await $today()

  // check if any of the task lists are not planned (in draft status)
  // TOTRANSLATE
  if (action !== 'remove' && await Parse.Query.and(query, $query('TaskList').equalTo('status', 0)).count({ useMasterKey: true })) {
    throw new Error('There are task lists that are not planned (in draft status) in this selection.')
  }

  if (action === 'remove' && await Parse.Query.and(query, $query('TaskList').greaterThan('status', 0)).count({ useMasterKey: true })) {
    throw new Error('There are task lists that are already planned in this selection that cannot be deleted.')
  }

  if (action === 'archive' && await Parse.Query.and(query, $query('TaskList').lessThan('status', 4)).count({ useMasterKey: true })) {
    throw new Error('There are task lists that are not completed')
  }

  let runFn
  // appoint manager
  // TODO: remove scouts with locationCleanup in case we allow this for retract as well
  if (action === 'manager') {
    const manager = form.managerId ? $parsify(Parse.User, form.managerId) : null
    runFn = async (taskList) => {
      await validateAppointAssign(taskList)
      let locationCleanup
      const changes = {}
      if (form.unsetManager && taskList.get('manager')) {
        changes.managerId = [taskList.get('manager').id, null]
        taskList.unset('manager')
        if ((taskList.get('scouts') || []).length) {
          changes.scoutIds = [taskList.get('scouts').map(x => x.id), []]
          taskList.unset('scouts')
        }
      }
      if (!form.unsetManager && form.managerId !== taskList.get('manager')?.id) {
        changes.managerId = [taskList.get('manager')?.id, form.managerId]
        taskList.set({ manager })
        taskList.unset('scouts')
      }
      if (form.setStatus !== undefined && form.setStatus !== null && taskList.get('status') !== form.setStatus) {
        changes.taskStatus = [taskList.get('status'), form.setStatus]
        locationCleanup = true
        taskList.set({ status: form.setStatus })
      }
      if (!$cleanDict(changes)) { return }
      const audit = { user, fn: 'task-list-update', data: { changes } }
      return taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup } })
    }
  }
  if (action === 'scouts') {
    const scouts = form.scoutIds ? form.scoutIds.map(id => $parsify(Parse.User, id)) : null
    runFn = async (taskList) => {
      await validateScoutManagerOrFieldworkManager(taskList, user)
      let locationCleanup
      if (taskList.get('status') > 1) {
        // TOTRANSLATE
        throw new Error('You cannot change scouts in an assigned task list. Please first retract.')
      }
      const currentScoutIds = (taskList.get('scouts') || []).map(s => s.id)

      const changes = {}
      if (form.unsetScouts && currentScoutIds.length) {
        changes.scoutIds = [currentScoutIds, []]
        taskList.unset('scouts')
      }
      if (!form.unsetScouts && (difference(form.scoutIds, currentScoutIds).length || difference(currentScoutIds, form.scoutIds).length)) {
        changes.scoutIds = [currentScoutIds, form.scoutIds]
        locationCleanup = currentScoutIds
        taskList.set({ scouts })
      }
      let notifyScouts
      if (taskList.get('status') > 1) {
        notifyScouts = form.scoutIds.filter(scoutId => !currentScoutIds.includes(scoutId))
      }
      if (form.setStatus !== undefined && form.setStatus !== null && taskList.get('status') !== form.setStatus) {
        changes.taskStatus = [taskList.get('status'), form.setStatus]
        taskList.set({ status: form.setStatus })
        if (form.setStatus === 2) {
          if (taskList.get('date') > today) {
            throw new Error(`You can assign this task only from ${moment(taskList.get('date')).format('DD.MM.YYYY')}`)
          }
          notifyScouts = true
        } else {
          locationCleanup = true
        }
      }
      if (!$cleanDict(changes)) { return }
      const audit = { user, fn: 'task-list-update', data: { changes } }
      return taskList.save(null, { useMasterKey: true, context: { audit, notifyScouts, locationCleanup } })
    }
  }
  if (action === 'retract-appoint') {
    runFn = async (taskList) => {
      // Validate if the user is a fieldwork manager before retracting appoint
      if (!user.get('permissions')?.includes('manage-fieldwork')) { throw new Error('Unbefugter Zugriff.') }
      const changes = {}
      if (taskList.get('status') !== 0.1) {
        changes.taskStatus = [taskList.get('status'), 0.1]
      }
      taskList.set({ status: 0.1 })
      if (form.unsetManager && taskList.get('manager')) {
        changes.managerId = [taskList.get('manager').id, null]
        taskList.unset('manager')
        if ((taskList.get('scouts') || []).length) {
          changes.scoutIds = [taskList.get('scouts').map(x => x.id), []]
          taskList.unset('scouts')
        }
      }
      if (!$cleanDict(changes)) { return }
      const audit = { user, fn: 'task-list-update', data: { changes } }
      return taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
    }
  }
  if (action === 'retract-assign') {
    runFn = async (taskList) => {
      // Validate if the user is a fieldwork manager or the manager of the list before retracting assign
      await validateScoutManagerOrFieldworkManager(taskList, user)
      const changes = {}
      if (taskList.get('status') !== 1) {
        changes.taskStatus = [taskList.get('status'), 1]
      }
      taskList.set({ status: 1 })
      if (form.unsetScouts && (taskList.get('scouts') || []).length) {
        changes.scoutIds = [taskList.get('scouts').map(x => x.id), []]
        taskList.unset('scouts')
      }
      if (!$cleanDict(changes)) { return }
      const audit = { user, fn: 'task-list-update', data: { changes } }
      return taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
    }
  }
  if (action === 'mark-complete') {
    runFn = async (taskList) => {
      if (!user.get('permissions')?.includes('manage-fieldwork')) { throw new Error('Unbefugter Zugriff.') }
      if (taskList.get('status') === 4.1) { return }
      taskList.set({ status: 4.1 })
      const audit = { user, fn: 'task-list-mark-complete' }
      return taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
    }
  }
  if (action === 'unmark-complete') {
    runFn = async (taskList) => {
      // Validate if the user is a fieldwork manager or the manager of the list before umarking complete
      await validateScoutManagerOrFieldworkManager(taskList, user)
      if (taskList.get('status') === 0.1) { return }
      taskList.set({ status: 0.1 })
      const audit = { user, fn: 'task-list-unmark-complete' }
      return taskList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  if (action === 'archive') {
    runFn = async (taskList) => {
      if (taskList.get('status') < 4) { return }
      if (taskList.get('archivedAt')) { return }
      taskList.set('archivedAt', new Date())
      const audit = { user, fn: 'task-list-archive' }
      return taskList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  if (action === 'remove') {
    runFn = async (taskList) => {
      // Validate if the user is a fieldwork manager
      if (!user.get('permissions')?.includes('manage-fieldwork')) { throw new Error('Unbefugter Zugriff.') }
      if (taskList.get('status') > 0) { return }
      return taskList.destroy({ useMasterKey: true })
    }
  }

  let updated = 0
  const errors = {}
  await query.eachBatch(async (taskLists) => {
    for (const taskList of taskLists) {
      try {
        Boolean(await runFn(taskList)) && updated++
      } catch (error) {
        errors[error.message] = (errors[error.message] || 0) + 1
      }
    }
  }, { useMasterKey: true })
  return { updated, errors }
}, { requireUser: true })

async function findStartedDisassemblyForControlTask (cubeId, taskListId) {
  const taskList = await $getOrFail('TaskList', taskListId)
  const control = taskList.get('control')
  const orderKey = control.get('cubeOrderKeys')[cubeId]
  if (!orderKey) {
    throw new Error('Für diesen CityCube kann kein laufender Auftrag innerhalb des Kontrols gefunden werden.')
  }
  const disassemblyIdPrefix = orderKey.replace('$', '-')
  const disassembliesQuery = $query('Disassembly').startsWith('objectId', disassemblyIdPrefix)
  // When do we match a disassembly task to a control task?
  // If the disassembly has started (date is less than or equal to today)
  // If the disassembly task starts before the control end date
  const query = Parse.Query.or(
    $query('TaskList').lessThanOrEqualTo('date', await $today()),
    $query('TaskList').lessThanOrEqualTo('date', control.get('dueDate'))
  )
  const disassemblyTask = await query
    .equalTo('type', 'disassembly')
    .matchesQuery('disassembly', disassembliesQuery)
    .equalTo('cubeIds', cubeId)
    .first({ useMasterKey: true })
  return { orderKey, disassemblyTask }
}

Parse.Cloud.define('task-list-get-control-order-status', ({ params: { cubeId, taskListId } }) => {
  return findStartedDisassemblyForControlTask(cubeId, taskListId)
}, { requireUser: true })

// what scout sees on location map when clicking on a cube
Parse.Cloud.define('task-list-retrieve-as-scout', async ({ params: { id: taskListId, cubeId }, user }) => {
  let task = await $query('TaskList').get(taskListId, { sessionToken: user.getSessionToken() })
  // control has disassembly within the control dates
  if (task.get('type') === 'control') {
    // check if there is a disassembly with the order key
    const { disassemblyTask } = await findStartedDisassemblyForControlTask(cubeId, taskListId)
    if (disassemblyTask) {
      // disable the control task
      task.set('disabled', true)
      // show disassembly button if the scout is assigned
      const userIsScout = !!disassemblyTask.get('scouts')?.find(s => s.id === user.id)
      if (userIsScout && TASK_LIST_IN_PROGRESS_STATUSES.includes(disassemblyTask.get('status'))) {
        task = disassemblyTask
      }
      const dateDisplay = moment(disassemblyTask.get('dueDate')).format('DD.MM.YYYY')
      task.set('information', `Diese CityCube wird bis zum ${dateDisplay} ohnehin demontiert.`)
    }
  }
  const submission = await $query(getSubmissionClass(task.get('type')))
    .equalTo('taskList', $parsify('TaskList', taskListId))
    .equalTo('cube', $parsify('Cube', cubeId))
    .first({ sessionToken: user.getSessionToken() })
  return { task: task.toJSON(), submission: submission?.toJSON() }
}, { requireUser: true })

module.exports = {
  getStatusAndCounts
}
