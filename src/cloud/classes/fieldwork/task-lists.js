const { capitalize, sum } = require('lodash')
const { taskLists: { normalizeFields } } = require('@/schema/normalizers')

const TaskList = Parse.Object.extend('TaskList')
const ScoutSubmission = Parse.Object.extend('ScoutSubmission')
const ControlSubmission = Parse.Object.extend('ControlSubmission')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')

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

Parse.Cloud.beforeSave(TaskList, async ({ object: taskList, context: { countCubes } }) => {
  !taskList.get('status') && taskList.set('status', 0)
  const cubeIds = [...new Set(taskList.get('cubeIds') || [])]
  cubeIds.sort()
  taskList.set('cubeIds', cubeIds)
  taskList.set('cubeCount', taskList.get('type') === 'scout' && taskList.get('quotas')
    ? sum(Object.values(taskList.get('quotas') || {}))
    : cubeIds.length)
  taskList.set('gp', await getCenterOfCubes(cubeIds))

  if (countCubes) {
    const submissionClass = capitalize(taskList.get('type')) + 'Submission'
    const pendingCubeIds = await $query(submissionClass)
      .equalTo('taskList', taskList)
      .equalTo('status', 'pending')
      .notEqualTo('form.notFound', true)
      .distinct('cube', { useMasterKey: true })
      .then(cubes => cubes.map(cube => cube.objectId))
    taskList.set('pendingCubeIds', pendingCubeIds)
    taskList.set('pendingCubeCount', pendingCubeIds.length)
    const approvedCubeIds = await $query(submissionClass)
      .equalTo('taskList', taskList)
      .equalTo('status', 'approved')
      .notEqualTo('form.notFound', true)
      .distinct('cube', { useMasterKey: true })
      .then(cubes => cubes.map(cube => cube.objectId))
    const adminApprovedCubeIds = taskList.get('adminApprovedCubeIds') || []
    approvedCubeIds.push(...adminApprovedCubeIds)
    taskList.set('approvedCubeIds', [...new Set(approvedCubeIds)])
    taskList.set('approvedCubeCount', approvedCubeIds.length)
    const rejectedCubeIds = await $query(submissionClass)
      .equalTo('taskList', taskList)
      .equalTo('status', 'rejected')
      .distinct('cube', { useMasterKey: true })
      .then(cubes => cubes.map(cube => cube.objectId))
    taskList.set('rejectedCubeIds', rejectedCubeIds)
    taskList.set('rejectedCubeCount', rejectedCubeIds.length)
    const pendingNotFoundCubeIds = await $query(submissionClass)
      .equalTo('taskList', taskList)
      .equalTo('status', 'pending')
      .equalTo('form.notFound', true)
      .distinct('cube', { useMasterKey: true })
      .then(cubes => cubes.map(cube => cube.objectId))
    taskList.set('pendingNotFoundCubeIds', pendingNotFoundCubeIds)
    taskList.get('scoutAddedCubeIds') && taskList.set('scoutAddedCubeIds', [...new Set(taskList.get('scoutAddedCubeIds'))])

    const quotas = taskList.get('quotas')
    if (quotas) {
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
    taskList.set('completedCubeCount', parseInt(pendingCubeIds.length + approvedCubeIds.length - rejectedCubeIds.length))
  }
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
    query.equalTo('scouts', user).greaterThanOrEqualTo('status', 2)
  }
})

Parse.Cloud.afterFind(TaskList, async ({ objects: taskLists, query }) => {
  const today = await $today()
  for (const taskList of taskLists) {
    !taskList.get('completedCubeCount') && taskList.set('completedCubeCount', 0)
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
    if (query._include.includes('cubeStatuses')) {
      const { cubeIds, pendingCubeIds, pendingNotFoundCubeIds, approvedCubeIds, rejectedCubeIds } = taskList.attributes
      const cubeStatuses = cubeIds.reduce((acc, cubeId) => {
        acc[cubeId] = 0
        if (pendingCubeIds?.includes(cubeId)) { acc[cubeId] = 1 }
        if (pendingNotFoundCubeIds?.includes(cubeId)) { acc[cubeId] = 3 }
        if (approvedCubeIds?.includes(cubeId)) { acc[cubeId] = 1 }
        if (rejectedCubeIds?.includes(cubeId)) { acc[cubeId] = 2 }
        return acc
      }, {})
      taskList.set({ cubeStatuses })
    }
    if (query._include.includes('cubeLocations')) {
      const cubeIds = taskList.get('cubeIds') || []
      const cubeLocations = await $query('Cube')
        .containedIn('objectId', cubeIds)
        .select('gp')
        .equalTo('dAt', null)
        .limit(cubeIds.length)
        .find({ useMasterKey: true })
        .then((cubes) => cubes.reduce((acc, cube) => {
          acc[cube.id] = cube.get('gp')
          return acc
        }, {}))
      taskList.set({ cubeLocations })
    }
  }
  return taskLists
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
}, { requireUser: true })

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
}, { requireUser: true })

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
}, { requireUser: true })

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
    data: taskList.get('quotas'),
    message: 'Anzahl gespeichert.'
  }
}, { requireUser: true })

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
}, { requireUser: true })

async function validateFinalize (taskList) {
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
  await validateFinalize(taskList)
  taskList.set({ status: 1 })
  const audit = { user, fn: 'task-list-appoint' }
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScout: true, setCubeStatuses: true } })
  return {
    data: taskList.get('status'),
    message: 'Abfahrtslist ernennt. Manager notified.'
  }
}, { requireUser: true })

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
  await validateFinalize(taskList)
  taskList.set({ status: 2 })
  const audit = { user, fn: 'task-list-assign' }
  await taskList.save(null, { useMasterKey: true, context: { audit, notifyScout: true, setCubeStatuses: true } })
  return {
    data: taskList.get('status'),
    message: 'Abfahrtslist beauftragt. Scout notified.'
  }
}, { requireUser: true })

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
  await taskList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return approved ? 'Verified cube marked as approved' : 'Cube unmarked as approved'
}, { requireUser: true })

// TODO: Removals
// Parse.Cloud.define('task-list-remove', async ({ params: { id: taskListId } }) => {
//   const taskList = await $getOrFail(TaskList, taskListId)
//   if (!(!taskList.get('status') || taskList.get('status') === 'appointed')) {
//     throw new Error('Only draft or appointed Abfahrtsliste can be removed.')
//   }
//   await taskList.destroy({ useMasterKey: true })
//   return { message: 'Abfahrtsliste gelöscht.' }
// }, { requireUser: true })

// TODO: Completion
// Parse.Cloud.define('task-list-complete', async ({ params: { id: taskListId }, user }) => {
//   const taskList = await $getOrFail(TaskList, taskListId)
//   if (taskList.get('status') !== 3) {
//     throw new Error('Only in_progress Abfahrtsliste can be completed.')
//   }
//   taskList.set({ status: 4 })
//   const audit = { user, fn: 'task-list-complete' }
//   return taskList.save(null, { useMasterKey: true, context: { audit } })
// }, { requireUser: true })

Parse.Cloud.define('scout-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, form, photoIds, comments }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const cube = await $getOrFail('Cube', cubeId)
  const submission = submissionId
    ? await $getOrFail(ScoutSubmission, submissionId)
    : await $query(ScoutSubmission)
      .equalTo('taskList', taskList)
      .equalTo('cube', cube)
      .first({ useMasterKey: true }) || new ScoutSubmission({ taskList, cube })
  submission.set({
    scout: user,
    status: 'pending'
  })

  // make sure the cube is added to the list if found
  const cubeIds = taskList.get('cubeIds') || []
  if (!cubeIds.includes(cubeId)) {
    cubeIds.push(cubeId)
    const scoutAddedCubeIds = taskList.get('scoutAddedCubeIds') || []
    scoutAddedCubeIds.push(cubeId)
    taskList.set({ cubeIds, scoutAddedCubeIds })
  }

  form.notFound = Boolean(form.notFound)
  let changes
  if (submissionId) {
    changes = $changes(submission.get('form'), form, true)
  }
  const photos = await $query('CubePhoto').containedIn('objectId', photoIds).find({ useMasterKey: true })
  submission.set({ form, photos })

  await submission.save(null, { useMasterKey: true })
  taskList.set({ status: 3 })
  const audit = { user, fn: 'scout-submission-submit', data: { cubeId, changes } }
  await taskList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  if (user.get('accType') === 'admin') {
    return Parse.Cloud.run('scout-submission-approve', { id: submission.id }, { sessionToken: user.get('sessionToken') })
  }
  return { message: 'Scouting erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('scout-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(ScoutSubmission, submissionId, ['taskList', 'cube', 'photos'])
  const cube = submission.get('cube')

  // if not found, soft delete the cube
  if (submission.get('form').notFound) {
    cube.set('dAt', new Date())
    await cube.save(null, { useMasterKey: true })
  } else {
    // save details to cube and approve photos
    const photos = submission.get('photos')
    await Parse.Object.saveAll(photos.map(photo => photo.set('approved', true)), { useMasterKey: true })
    const form = submission.get('form')
    const { str, hsnr, ort, plz } = form.address
    cube.set({ str, hsnr, ort, plz })
    const { stateId, htId, media } = form
    cube.set('state', $parsify('State', stateId))
    cube.set('media', media)
    cube.set('ht', $parsify('HousingType', htId))
    const { sides } = form
    cube.set({ sides, vAt: new Date() })
    await cube.save(null, { useMasterKey: true })
  }

  submission.set({ status: 'approved' })
  const audit = { user, fn: 'scout-submission-approve', data: { cubeId: cube.id } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return { message: 'Scouting genehmigt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('scout-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(ScoutSubmission, submissionId, ['taskList', 'cube'])
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  if (submission.get('form').notFound) {
    cube.unset('dAt')
    await cube.save(null, { useMasterKey: true })
  }
  const audit = { user, fn: 'scout-submission-reject', data: { cubeId: cube.id, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  await $notify({
    user: submission.get('scout'),
    message: `Your submission for ${submission.get('cube').id} was rejected. ${rejectionReason}`,
    uri: `/task-lists/${submission.get('taskList').id}/scout/${submission.get('cube').id}`,
    data: { rejectionReason }
  })
  return { message: 'Scouting abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, beforePhotoId, afterPhotoId, comments }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const cube = await $getOrFail('Cube', cubeId)
  const submission = submissionId
    ? await $getOrFail(ControlSubmission, submissionId)
    : await $query(ControlSubmission)
      .equalTo('taskList', taskList)
      .equalTo('cube', cube)
      .first({ useMasterKey: true }) || new ControlSubmission({ taskList, cube })
  if (condition !== 'no_ad' && condition !== 'disassembled') {
    comments = null
  }
  let changes
  if (submission.id) {
    changes = $changes(submission, { condition, comments })
  }
  submission.set({
    scout: user,
    status: 'pending',
    condition,
    comments
  })
  submission.set('beforePhoto', beforePhotoId ? await $getOrFail('FileObject', beforePhotoId) : null)
  submission.set('afterPhoto', afterPhotoId ? await $getOrFail('FileObject', afterPhotoId) : null)
  await submission.save(null, { useMasterKey: true })
  taskList.set({ status: 3 })
  const audit = { user, fn: 'control-submission-submit', data: { cubeId, changes } }
  await taskList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return { message: 'Kontrolle erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(ControlSubmission, submissionId, ['taskList'])
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'control-submission-approve', data: { cubeId } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return { message: 'Kontrolle genehmigt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(ControlSubmission, submissionId, ['taskList'])
  submission.set({ status: 'rejected', rejectionReason })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'control-submission-reject', data: { cubeId, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  await $notify({
    user: submission.get('scout'),
    message: `Your submission for ${submission.get('cube').id} was rejected. ${rejectionReason}`,
    uri: `/task-lists/${submission.get('taskList').id}/control/${submission.get('cube').id}`,
    data: { rejectionReason }
  })
  return { message: 'Kontrolle abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, photoId, comments }, user }) => {
  const taskList = await $getOrFail(TaskList, taskListId)
  const cube = await $getOrFail('Cube', cubeId)
  // even if submissionId was not given, check to see if there is an existing submission
  const submission = submissionId
    ? await $getOrFail(DisassemblySubmission, submissionId)
    : await $query(DisassemblySubmission)
      .equalTo('taskList', taskList)
      .equalTo('cube', cube)
      .first({ useMasterKey: true }) || new DisassemblySubmission({ taskList, cube })
  let changes
  if (condition === 'true') {
    comments = null
  }
  if (submission.id) {
    changes = $changes(submission, { condition, comments })
  }
  submission.set({
    scout: user,
    condition,
    status: 'pending',
    photo: photoId ? await $getOrFail('FileObject', photoId) : null,
    comments
  })
  const audit = { user, fn: 'disassembly-submission-submit', data: { cubeId, changes } }
  await submission.save(null, { useMasterKey: true })

  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  // control-disassembled
  const controlList = await $query('TaskList')
    .equalTo('type', 'control')
    .equalTo('cubeIds', cubeId)
    .first({ sessionToken: user.getSessionToken() })
  controlList && await Parse.Cloud.run('control-submission-submit', {
    id: controlList.id,
    cubeId,
    condition: 'disassembled',
    comment: ['forward', 'disassembly', taskList.id, submission.id].join(':')
  }, { sessionToken: user.getSessionToken() })
  return { message: 'Abbau erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $query(DisassemblySubmission).include(['taskList']).get(submissionId, { useMasterKey: true })
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'disassembly-submission-approve', data: { cubeId } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  // control-disassembled
  const controlSubmission = await $query(ControlSubmission)
    .equalTo('comment', ['forward', 'disassembly', submission.get('taskList').id, submission.id].join(':'))
    .first({ useMasterKey: true })
  controlSubmission && await Parse.Cloud.run('control-submission-approve', {
    id: controlSubmission.id
  }, { sessionToken: user.getSessionToken() })
  return { message: 'Abbau genehmigt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(DisassemblySubmission, submissionId)
  submission.set({ status: 'rejected', rejectionReason })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'disassembly-submission-reject', data: { cubeId } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  await $notify({
    user: submission.get('scout'),
    message: `Your submission for ${submission.get('cube').id} was rejected. ${rejectionReason}`,
    uri: `/task-lists/${submission.get('taskList').id}/disassembly/${submission.get('cube').id}`,
    data: { rejectionReason }
  })
  return { message: 'Abbau abgelehnt.', data: submission }
}, { requireUser: true })
