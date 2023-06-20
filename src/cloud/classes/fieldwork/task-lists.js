const { capitalize, sum, intersection, isArray, difference } = require('lodash')
const { taskLists: { normalizeFields } } = require('@/schema/normalizers')
const { indexTaskList, unindexTaskList } = require('@/cloud/search')
const TaskList = Parse.Object.extend('TaskList')

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

Parse.Cloud.beforeSave(TaskList, async ({ object: taskList }) => {
  !taskList.get('status') && taskList.set('status', 0)

  const cubeIds = [...new Set(taskList.get('cubeIds') || [])]
  cubeIds.sort()

  taskList.set('cubeIds', cubeIds)
  taskList.set('cubeCount', cubeIds.length)
  taskList.set('gp', await getCenterOfCubes(cubeIds))
  taskList.set('pk', $pk(taskList))

  for (const cubeIdField of ['adminApprovedCubeIds', 'scoutAddedCubeIds']) {
    taskList.get(cubeIdField) && taskList.set(cubeIdField, intersection([...new Set(taskList.get(cubeIdField))], cubeIds))
  }

  const taskType = taskList.get('type')

  const submissionClass = capitalize(taskType) + 'Submission'
  const submissions = taskList.isNew()
    ? []
    : await $query(submissionClass).equalTo('taskList', taskList).limit(cubeIds.length).find({ useMasterKey: true })

  const statuses = {}
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

  if (!taskList.isNew() && taskType === 'scout') {
    const quota = taskList.get('quota')
    const quotas = taskList.get('quotas')
    counts.total = quota || sum(Object.values(quotas || {}))
    const quotasCompleted = {}
    for (const media of ['MFG', 'KVZ']) {
      quotasCompleted[media] = await $query(submissionClass)
        .equalTo('taskList', taskList)
        .containedIn('status', ['pending', 'approved'])
        .notEqualTo('form.notFound', true)
        .equalTo('form.media', media)
        .count({ useMasterKey: true })
      // add on top media of admin approved cubes
      quotasCompleted[media] += await $query('Cube')
        .containedIn('objectId', adminApprovedCubeIds)
        .equalTo('media', media)
        .count({ useMasterKey: true })
    }
    taskList.set({ quotasCompleted })
  }
  taskList.set({ statuses, counts })
})

Parse.Cloud.afterSave(TaskList, async ({ object: taskList, context: { audit, notifyScouts, locationCleanup } }) => {
  await indexTaskList(taskList)
  $audit(taskList, audit)
  const placeKey = [taskList.get('state').id, taskList.get('ort')].join(':')
  for (const scout of taskList.get('scouts') || []) {
    if (notifyScouts === true || notifyScouts?.includes(scout.id)) {
      await $notify({
        user: scout,
        identifier: 'task-list-assigned',
        data: { placeKey }
      })
    }
  }
  // check if scout has other active tasks in the location
  if (locationCleanup) {
    const placeKey = taskList.get('state').id + ':' + taskList.get('ort')
    for (const scout of taskList.get('scouts') || []) {
      const count = await $query('TaskList')
        .equalTo('ort', taskList.get('ort'))
        .equalTo('state', taskList.get('state'))
        .equalTo('scouts', scout)
        .containedIn('status', [2, 3])
        .count({ useMasterKey: true })
      if (!count) {
        $query('Notification')
          .equalTo('user', scout)
          .containedIn('identifier', ['task-list-assigned', 'task-submission-rejected'])
          .equalTo('data.placeKey', placeKey)
          .each(notification => notification.destroy({ useMasterKey: true }), { useMasterKey: true })
      }
    }
  }
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
    query.equalTo('scouts', user).containedIn('status', [2, 3])
  }
})

Parse.Cloud.afterFind(TaskList, async ({ objects: taskLists, query }) => {
  const today = await $today()
  for (const taskList of taskLists) {
    taskList.set('parent', taskList.get('briefing') || taskList.get('control') || taskList.get('disassembly'))
    taskList.set('dueDays', moment(taskList.get('dueDate')).diff(today, 'days'))
    if (query._include.includes('submissions')) {
      const submissionClass = capitalize(taskList.get('type')) + 'Submission'
      taskList.set('submissions', await $query(submissionClass).equalTo('taskList', taskList).find({ useMasterKey: true }))
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

Parse.Cloud.beforeDelete(TaskList, async ({ object: taskList }) => {
  await unindexTaskList(taskList)
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

// TOTRANSLATE
async function validateAppointAssign (taskList) {
  if (!taskList.get('cubeIds').length) {
    throw new Error('This task list has no cubes!')
  }
  if (!taskList.get('date') || !taskList.get('dueDate')) {
    throw new Error('Please set date and due date first.')
  }
  if (taskList.get('type') === 'scout') {
    if (!taskList.get('quotas') && !taskList.get('quota')) {
      throw new Error('Please set quotas.')
    }
  }
  const { ort, state: { id: stateId } } = taskList.attributes
  // validate cubes
  const cubeIds = taskList.get('cubeIds') || []
  const cubes = await $query('Cube').containedIn('objectId', cubeIds).limit(cubeIds.length).find({ useMasterKey: true })
  if (!cubes.length) { throw new Error('No cubes found') }
  if (cubes.some(cube => cube.get('ort') !== ort || cube.get('state').id !== stateId)) {
    throw new Error('There are cubes outside of the location of this list')
  }

  // reject booked cubes
  if (taskList.get('type') === 'scout') {
    for (const cube of cubes) {
      // TOTRANSLATE
      if (cube.get('order')) { throw new Error('List has booked cubes!') }
    }
  }
}

// Used in marklist store component to save manual cube changes
// TOTRANSLATE
Parse.Cloud.define('task-list-update-cubes', async ({ params: { id: taskListId, cubeIds }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('type') !== 'scout' || !taskList.get('briefing')) {
    throw new Error('Cannot change cubes in this task list')
  }
  if (taskList.get('status')) {
    throw new Error('You cannot change cubes in an assigned task list')
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

Parse.Cloud.define('scout-list-remove-booked-cubes', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('type') !== 'scout') { throw new Error('This is only for scout lists') }
  const bookedCubeIds = await $query('Cube')
    .containedIn('objectId', taskList.get('cubeIds'))
    .notEqualTo('order', null)
    .distinct('objectId', { useMasterKey: true })
  if (!bookedCubeIds.length) { return }
  // return the difference between the current cubeIds and the booked ones
  const cubeIds = taskList.get('cubeIds').filter(id => !bookedCubeIds.includes(id))
  const cubeChanges = $cubeChanges(taskList, cubeIds)
  if (!cubeChanges) { throw new Error('Keine Änderungen') }
  taskList.set({ cubeIds })
  const audit = { user, fn: 'task-list-update', data: { cubeChanges, reason: 'CityCubes schon vermarktet.' } }
  return taskList.save(null, { useMasterKey: true, context: { audit } })
})

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
  if (taskList.get('status') > 0) {
    // TOTRANSLATE
    throw new Error('You cannot change an assigned manager. Please first retract.')
  }
  const { managerId } = normalizeFields(params)
  if (managerId === taskList.get('manager')?.id) {
    throw new Error('Keine Änderungen')
  }
  const changes = { managerId: [taskList.get('manager')?.id, managerId] }
  taskList.set('manager', managerId ? await $getOrFail(Parse.User, managerId) : null)

  const currentScoutIds = (taskList.get('scouts') || []).map(s => s.id)
  if (currentScoutIds.length) {
    changes.scoutIds = [currentScoutIds, []]
  }
  taskList.unset('scouts')
  const audit = { user, fn: 'task-list-update', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: { manager: taskList.get('manager'), scouts: taskList.get('scouts') },
    message: 'Manager gespeichert.'
  }
}, $fieldworkManager)

Parse.Cloud.define('task-list-update-scouts', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  await validateScoutManagerOrFieldworkManager(taskList, user)
  if (taskList.get('status') > 1) {
    // TOTRANSLATE
    throw new Error('You cannot change scouts in an assigned task list. Please first retract.')
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
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScouts } })
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
  if (!Object.keys(changes).length) {
    throw new Error('Keine Änderungen')
  }
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
  if (taskList.get('status')) {
    // TOTRANSLATE
    throw new Error('Only draft Abfahrtsliste can be appointed.')
  }
  if (!taskList.get('manager')) {
    // TOTRANSLATE
    throw new Error('Need a manager to appoint to')
  }
  await validateAppointAssign(taskList)
  taskList.set({ status: 1 })
  const audit = { user, fn: 'task-list-appoint' }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: taskList.get('status'),
    message: 'Abfahrtslist ernennt. Manager notified.'
  }
}, $fieldworkManager)

Parse.Cloud.define('task-list-assign', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  await validateScoutManagerOrFieldworkManager(taskList, user)

  if (!taskList.get('manager') || taskList.get('status') !== 1) {
    // TOTRANSLATE
    throw new Error('Only Abfahrtsliste appointed to a manager be assigned.')
  }
  if (!(taskList.get('scouts') || []).length) {
    throw new Error('Need at least one scout to assign to')
  }
  if (moment(taskList.get('date')).isAfter(await $today(), 'day')) {
    throw new Error(`You can assign this task only from ${moment(taskList.get('date')).format('DD.MM.YYYY')}`)
  }
  await validateAppointAssign(taskList)
  taskList.set({ status: 2 })
  const audit = { user, fn: 'task-list-assign' }
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScouts: true } })
  return {
    data: taskList.get('status'),
    message: 'Abfahrtslist beauftragt.'
  }
}, { requireUser: true })

Parse.Cloud.define('task-list-retract', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (![1, 2, 3].includes(taskList.get('status'))) {
    throw new Error('Only lists that are in progress or assigned to a scout can be retracted.')
  }
  const audit = { user }
  let message
  if (taskList.get('status') === 1) {
    // Validate if the user is a fieldwork manager before retracting appoint
    if (!user.get('permissions')?.includes('manage-fieldwork')) { throw new Error('Unbefugter Zugriff.') }
    taskList.set({ status: 0 })
    audit.fn = 'task-list-retract-appoint'
    message = 'Ernennung zurückgezogen.'
  } else {
    // Validate if the user is a fieldwork manager or the manager of the list before retracting assing
    await validateScoutManagerOrFieldworkManager(taskList, user)
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
  return taskList.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('task-list-remove', async ({ params: { id: taskListId } }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status')) { throw new Error('Only draft lists can be removed.') }
  await taskList.destroy({ useMasterKey: true })
  return { message: 'Abfahrtsliste gelöscht.' }
}, $fieldworkManager)

// check if location has tasks remaining
Parse.Cloud.define('task-list-complete', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  taskList.set({ status: 4 })
  const audit = { user, fn: 'task-list-complete' }
  await taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
  return {
    data: taskList.get('status'),
    message: 'Task list marked complete'
  }
}, $fieldworkManager)

// retract complete mark
Parse.Cloud.define('task-list-retract-complete', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status') !== 4) { throw new Error('Only completed can be retracted') }
  taskList.set({ status: 0 })
  const audit = { user, fn: 'task-list-retract-complete' }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: taskList.get('status'),
    message: 'Task list retracted'
  }
}, $fieldworkManager)

async function getQueryFromSelection (selection, count) {
  const query = $query(TaskList)
  if (isArray(selection)) {
    query.containedIn('objectId', selection)
    return query
  }

  // parent
  selection.briefing && query.equalTo('briefing', $parsify('Briefing', selection.briefing))
  selection.control && query.equalTo('control', $parsify('Control', selection.control))
  // selection.assembly && query.equalTo('assembly', $parsify('Assembly', selection.assembly))
  selection.disassembly && query.equalTo('disassembly', $parsify('Disassembly', selection.disassembly))

  selection.state && query.equalTo('state', $parsify('State', selection.state))
  selection.type && query.equalTo('type', selection.type)
  // TODO
  // selection.start && query.equalTo('type', type)
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
  selection.status && query.containedIn('status', selection.status.split(',').filter(Boolean).map(parseFloat))
  const queryCount = await query.count({ useMasterKey: true })
  if (count !== queryCount) {
    throw new Error(`Count mismatch should ${count} !== was ${queryCount}`)
  }
  return query
}

// mass updates
Parse.Cloud.define('task-list-mass-update-preview', async ({ params: { selection, count } }) => {
  const query = await getQueryFromSelection(selection, count)
  // return different previews based on action
  const response = {
    statuses: {},
    managers: {},
    scouts: {},
    quotasIncomplete: 0
  }
  // TODO: Add no-quota and has-booked-cube checks
  await query
    .select('type', 'manager', 'scouts', 'status', 'statuses', 'quota', 'quotas')
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
      }
    }, { useMasterKey: true })
  return response
}, { requireUser: true })

Parse.Cloud.define('task-list-mass-update-run', async ({ params: { action, selection, count, ...form }, user }) => {
  const query = await getQueryFromSelection(selection, count)

  let runFn
  // appoint manager
  // TODO: remove scouts with locationcleanup in case we allow this for retract as well
  if (action === 'manager') {
    const manager = form.managerId ? $parsify(Parse.User, form.managerId) : null
    runFn = async (taskList) => {
      await validateAppointAssign(taskList)
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
        taskList.set({ status: form.setStatus })
      }
      if (!$cleanDict(changes)) { return }
      const audit = { user, fn: 'task-list-update', data: { changes } }
      return taskList.save(null, { useMasterKey: true, context: { audit } })
    }
  }

  if (action === 'scouts') {
    const scouts = form.scoutIds ? form.scoutIds.map(id => $parsify(Parse.User, id)) : null
    runFn = async (taskList) => {
      await validateScoutManagerOrFieldworkManager(taskList, user)
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
          notifyScouts = true
        }
      }
      if (!$cleanDict(changes)) { return }
      const audit = { user, fn: 'task-list-update', data: { changes } }
      return taskList.save(null, { useMasterKey: true, context: { audit, notifyScouts } })
    }
  }

  if (action === 'retract-appoint') {
    runFn = async (taskList) => {
      // Validate if the user is a fieldwork manager before retracting appoint
      if (!user.get('permissions')?.includes('manage-fieldwork')) { throw new Error('Unbefugter Zugriff.') }
      const changes = {}
      if (taskList.get('status') !== 0) {
        changes.taskStatus = [taskList.get('status'), 0]
      }
      taskList.set({ status: 0 })
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
      return taskList.save(null, { useMasterKey: true, context: { audit } })
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
  if (action === 'complete') {
    runFn = async (taskList) => {
      if (!user.get('permissions')?.includes('manage-fieldwork')) { throw new Error('Unbefugter Zugriff.') }
      if (taskList.get('status') === 4) { return }
      taskList.set({ status: 4 })
      const audit = { user, fn: 'task-list-complete' }
      return taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
    }
  }
  if (action === 'retract-complete') {
    runFn = async (taskList) => {
      // Validate if the user is a fieldwork manager or the manager of the list before retracting assign
      await validateScoutManagerOrFieldworkManager(taskList, user)
      if (taskList.get('status') === 0) { return }
      taskList.set({ status: 0 })
      const audit = { user, fn: 'task-list-retract-complete' }
      return taskList.save(null, { useMasterKey: true, context: { audit } })
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
