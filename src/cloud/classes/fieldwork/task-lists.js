const { capitalize, sum } = require('lodash')
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

  taskList.get('adminApprovedCubeIds') && taskList.set('adminApprovedCubeIds', [...new Set(taskList.get('adminApprovedCubeIds'))])
  taskList.get('scoutAddedCubeIds') && taskList.set('scoutAddedCubeIds', [...new Set(taskList.get('scoutAddedCubeIds'))])

  const taskType = taskList.get('type')
  const quotas = taskList.get('quotas')

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
  counts.completed = parseInt(counts.pending + counts.approved - counts.rejected)

  if (taskType === 'scout' && quotas) {
    counts.total = sum(Object.values(quotas || {}))
    const quotasCompleted = {}
    for (const media of Object.keys(quotas)) {
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

Parse.Cloud.afterSave(TaskList, async ({ object: taskList, context: { audit, notifyScouts } }) => {
  $audit(taskList, audit)
  notifyScouts && consola.warn('Todo: Notify together')
  // notifyScouts && $notify({
  //   user: taskList.get('scouts'),
  //   message: `You have been assigned to scout ${taskList.get('ort')}`,
  //   uri: `/task-lists/${taskList.id}`,
  //   data: { taskListId: taskList.id }
  // })
})

Parse.Cloud.beforeFind(TaskList, async ({ query, user, master }) => {
  query.include(['briefing', 'control', 'contract', 'booking'])
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

Parse.Cloud.define('task-list-update-manager', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const { managerId } = normalizeFields(params)
  if (managerId === taskList.get('manager')?.id) {
    throw new Error('Keine Änderungen')
  }
  const changes = { managerId: [taskList.get('manager')?.id, managerId] }
  taskList.set('manager', managerId ? await $getOrFail(Parse.User, managerId) : null)
  const manager = managerId ? $parsify(Parse.User, managerId) : null
  taskList.set({ manager })
  const audit = { user, fn: 'task-list-update', data: { changes } }
  const notifyManager = false
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyManager } })
  return {
    data: taskList.get('manager'),
    message: 'Manager gespeichert.'
  }
}, $adminOnly)

Parse.Cloud.define('task-list-update-scouts', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const { scoutIds } = normalizeFields(params)
  const currentScoutIds = (taskList.get('scouts') || []).map(s => s.id)
  if (scoutIds === currentScoutIds) {
    throw new Error('Keine Änderungen')
  }
  const changes = { scoutIds: [currentScoutIds, scoutIds] }
  taskList.set('scouts', scoutIds ? scoutIds.map(id => $parsify(Parse.User, id)) : null)
  const audit = { user, fn: 'task-list-update', data: { changes } }
  // TODO: Notify when changing scout
  let notifyScouts
  // const notifyScouts = !!taskList.get('status')
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScouts } })
  return {
    data: taskList.get('scouts'),
    message: `Abfahrtsliste gespeichert. ${notifyScouts ? 'Scouts notified.' : ''}`
  }
}, $scoutManagerOrAdmin)

Parse.Cloud.define('task-list-update-quotas', async ({ params: { id: taskListId, ...params }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('type') !== 'scout') {
    throw new Error('Nur für Scout-Listen')
  }
  const { quotas } = normalizeFields({ ...params, type: taskList.get('type') })

  const changes = $changes(taskList, { quotas })
  if (!changes.quotas) {
    throw new Error('Keine Änderungen')
  }
  taskList.set({ quotas })
  const audit = { user, fn: 'task-list-update', data: { changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: { quotas: taskList.get('quotas'), counts: taskList.get('counts') },
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

async function validateAppointAssign (taskList) {
  if (!taskList.get('date') || !taskList.get('dueDate')) {
    throw new Error('Please set date and due date first.')
  }
  if (taskList.get('type') === 'scout') {
    if (!taskList.get('quotas')) {
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
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScout: true, setCubeStatuses: true } })
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
    throw new Error('Need a scout to assign to')
  }
  if (moment(taskList.get('date')).isAfter(await $today(), 'day')) {
    throw new Error(`You can assign this task only from ${moment(taskList.get('date')).format('DD.MM.YYYY')}`)
  }
  await validateAppointAssign(taskList)
  taskList.set({ status: 2 })
  const audit = { user, fn: 'task-list-assign' }
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScout: true, setCubeStatuses: true } })
  return {
    data: taskList.get('status'),
    message: 'Abfahrtslist beauftragt. Scout notified.'
  }
}, $scoutManagerOrAdmin)

Parse.Cloud.define('task-list-approve-verified-cube', async ({ params: { id: taskListId, cubeId, approved }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const cube = await $getOrFail('Cube', cubeId)
  if (!cube.get('vAt')) {
    throw new Error('Only verified cubes can be approved')
  }
  let adminApprovedCubeIds = taskList.get('adminApprovedCubeIds') || []
  adminApprovedCubeIds = approved
    ? [...adminApprovedCubeIds, cubeId]
    : adminApprovedCubeIds.filter(id => id !== cubeId)

  taskList.set('adminApprovedCubeIds', [...new Set(adminApprovedCubeIds)])
  const audit = { user, fn: 'scout-submission-preapprove', data: { cubeId, approved } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return approved ? 'Verified cube marked as approved' : 'Cube unmarked as approved'
}, $internOrAdmin)

// TODO: briefing lists should be removeable by intern users?
Parse.Cloud.define('task-list-remove', async ({ params: { id: taskListId } }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status')) {
    throw new Error('Only draft lists can be removed.')
  }
  await taskList.destroy({ useMasterKey: true })
  return { message: 'Abfahrtsliste gelöscht.' }
}, $internOrAdmin)

Parse.Cloud.define('task-list-complete', async ({ params: { id: taskListId }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  if (taskList.get('status') !== 3) {
    throw new Error('Only in_progress Abfahrtsliste can be completed.')
  }
  taskList.set({ status: 4 })
  const audit = { user, fn: 'task-list-complete' }
  return taskList.save(null, { useMasterKey: true, context: { audit } })
}, $scoutManagerOrAdmin)

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
