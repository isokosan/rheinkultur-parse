const { capitalize, sum, intersection } = require('lodash')
const { taskLists: { normalizeFields } } = require('@/schema/normalizers')
const { indexTaskList, unindexTaskList } = require('@/cloud/search')
const TaskList = Parse.Object.extend('TaskList')

// $query('TaskList').each(tl => tl.save(null, { useMasterKey: true }), { useMasterKey: true }).then(consola.success)

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
  await indexTaskList(taskList)
})

Parse.Cloud.afterSave(TaskList, async ({ object: taskList, context: { audit, notifyScouts, locationCleanup } }) => {
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
    if (taskList.get('type') === 'scout') {
      if (!taskList.get('dueDate')) {
        taskList.set('dueDate', taskList.get('briefing')?.get('dueDate'))
      }
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
    taskList.set('dueDays', moment(taskList.get('dueDate')).diff(today, 'days'))
    if (query._include.includes('submissions')) {
      const submissionClass = capitalize(taskList.get('type')) + 'Submission'
      taskList.set('submissions', await $query(submissionClass).equalTo('taskList', taskList).find({ useMasterKey: true }))
    }
  }
  return taskLists
})

Parse.Cloud.beforeDelete(TaskList, async ({ object: taskList }) => {
  await unindexTaskList(taskList)
})

Parse.Cloud.afterDelete(TaskList, $deleteAudits)

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
}, $adminOnly)

Parse.Cloud.define('task-list-locations', async ({ params: { parent: { className, objectId } } }) => {
  return $query('TaskList').equalTo(className.toLowerCase(), $parsify(className, objectId)).distinct('pk')
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
  const manager = managerId ? $parsify(Parse.User, managerId) : null
  taskList.set({ manager })
  const audit = { user, fn: 'task-list-update', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: taskList.get('manager'),
    message: 'Manager gespeichert.'
  }
}, $adminOnly)

Parse.Cloud.define('task-list-update-scouts', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
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
}, $scoutManagerOrAdmin)

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
}, $adminOnly)

Parse.Cloud.define('task-list-update-due-date', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const { dueDate } = normalizeFields({ ...params, type: taskList.get('type') })

  const changes = $changes(taskList, { dueDate })
  if (!changes.dueDate) {
    throw new Error('Keine Änderungen')
  }
  taskList.set({ dueDate })
  const audit = { user, fn: 'task-list-update', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: taskList.get('dueDate'),
    message: 'Fälligkeitsdatum gespeichert.'
  }
}, $adminOnly)

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
      if (cube.get('order')) { throw new Error('Cannot finalize a scout list with booked cubes!') }
    }
  }
}

Parse.Cloud.define('task-list-appoint', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status')) {
    throw new Error('Only draft Abfahrtsliste can be appointed.')
  }
  if (!taskList.get('manager')) {
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
}, $adminOnly)

Parse.Cloud.define('task-list-assign', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (!taskList.get('manager') || taskList.get('status') !== 1) {
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
}, $scoutManagerOrAdmin)

Parse.Cloud.define('task-list-retract', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (![1, 2, 3].includes(taskList.get('status'))) {
    throw new Error('Only lists that are in progress or assigned to a scout can be retracted.')
  }
  const audit = { user }
  let message
  if (taskList.get('status') === 1) {
    // make sure the user has "manage-fieldwork" permissions
    taskList.set({ status: 0 })
    audit.fn = 'task-list-retract-appoint'
    message = 'Ernennung zurückgezogen.'
  } else {
    taskList.set({ status: 1 })
    audit.fn = 'task-list-retract-assign'
    message = 'Beauftragung zurückgezogen.'
  }
  await taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
  return {
    data: taskList.get('status'),
    message
  }
}, $scoutManagerOrAdmin)

Parse.Cloud.define('task-list-approve-verified-cube', async ({ params: { id: taskListId, cubeId, approved }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const cube = await $getOrFail('Cube', cubeId)
  if (taskList.get('type') === 'scout' && !cube.get('vAt')) {
    throw new Error('Only verified cubes can be approved')
  }
  let adminApprovedCubeIds = taskList.get('adminApprovedCubeIds') || []
  adminApprovedCubeIds = approved
    ? [...adminApprovedCubeIds, cubeId]
    : adminApprovedCubeIds.filter(id => id !== cubeId)

  taskList.set('adminApprovedCubeIds', [...new Set(adminApprovedCubeIds)])
  const audit = { user, fn: 'scout-submission-preapprove', data: { cubeId, approved } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  if (taskList.get('type') === 'scout') {
    return approved ? 'Verified cube marked as approved' : 'Cube unmarked as approved'
  }
  return approved ? 'Marked as complete' : 'Cube unmarked as complete'
}, $internOrAdmin)

Parse.Cloud.define('task-list-remove', async ({ params: { id: taskListId } }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status')) { throw new Error('Only draft lists can be removed.') }
  await taskList.destroy({ useMasterKey: true })
  return { message: 'Abfahrtsliste gelöscht.' }
}, $internOrAdmin)

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
}, $internOrAdmin)

// revert complete mark
Parse.Cloud.define('task-list-revert-complete', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status') !== 4) { throw new Error('Only completed can be reverted') }
  taskList.set({ status: 0 })
  const audit = { user, fn: 'task-list-revert-complete' }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: taskList.get('status'),
    message: 'Task list reverted'
  }
}, $internOrAdmin)

// async function massUpdateManager() {
//   const query = $query('TaskList')
//     .equalTo('state', $parsify('State', 'BY'))
//     .equalTo('status', 0)
//     .equalTo('manager', null)
//   const taskListIds = await query.distinct('objectId', { useMasterKey: true })
//   for (const id of taskListIds) {
//     await Parse.Cloud.run('task-list-update-manager', { id, managerId: 'Uuk3gJOFBV' }, { useMasterKey: true })
//     consola.info('manager set')
//   }
// }
// massUpdateManager()

// async function massAppoint() {
//   const query = $query('TaskList')
//     .equalTo('status', 0)
//     .notEqualTo('manager', null)
//   const taskListIds = await query.distinct('objectId', { useMasterKey: true })
//   for (const id of taskListIds) {
//     await Parse.Cloud.run('task-list-appoint', { id }, { useMasterKey: true })
//       .then(() => consola.success('appointed'))
//       .catch(consola.error)
//   }
// }
// massAppoint()
