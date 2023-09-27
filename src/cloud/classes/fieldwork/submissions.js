const TaskList = Parse.Object.extend('TaskList')
const ScoutSubmission = Parse.Object.extend('ScoutSubmission')
const ControlSubmission = Parse.Object.extend('ControlSubmission')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')

const { TASK_LIST_IN_PROGRESS_STATUSES } = require('@/schema/enums')

Parse.Cloud.afterFind(ControlSubmission, async ({ query, objects: submissions }) => {
  if (query._include.includes('orders')) {
    const orderKeys = [...new Set(submissions.map(submission => submission.get('orderKey')))]
    const orders = {}
    for (const className of ['Contract', 'Booking']) {
      const ids = orderKeys.filter(key => key.startsWith(className)).map(key => key.split('$')[1])
      const query = $query(className)
        .containedIn('objectId', ids)
        .limit(ids.length)
        .select(['no', 'status', 'motive', 'externalOrderNo', 'campaignNo'])
      for (const item of await query.find({ useMasterKey: true })) {
        orders[[item.className, item.id].join('$')] = {
          ...item.attributes,
          objectId: item.id,
          className
        }
      }
    }
    for (const submission of submissions) {
      const order = orders[submission.get('orderKey')]
      submission.set('order', order)
    }
  }
})

Parse.Cloud.afterSave(ControlSubmission, async ({ object: submission }) => {
  // cleanup unused cube photos
  const scopes = ['before', 'after'].map(type => ['control', type, 'TL', submission.get('taskList').id].join('-'))
  const formPhotoIds = ['beforePhotos', 'afterPhotos'].map(key => (submission.get(key) || []).map(photo => photo.id)).flat()
  await $query('CubePhoto')
    .equalTo('cubeId', submission.get('cube').id)
    .containedIn('scope', scopes)
    .notContainedIn('objectId', formPhotoIds)
    .eachBatch(async (records) => {
      for (const record of records) {
        await record.destroy({ useMasterKey: true })
      }
    }, { useMasterKey: true })
})

Parse.Cloud.afterSave(DisassemblySubmission, async ({ object: submission }) => {
  await submission.fetchWithInclude(['taskList.disassembly.booking', 'taskList.disassembly.contract'], { useMasterKey: true })
  const order = await submission.get('taskList').get('disassembly').get('order').fetch({ useMasterKey: true })
  const disassembly = order.get('disassembly')
  const cubeId = submission.get('cube').id

  const submissions = disassembly.submissions || {}
  submissions[cubeId] = submission.id
  disassembly.submissions = $cleanDict(submissions)

  const statuses = disassembly.statuses || {}
  submission.get('status') === 'approved'
    ? (statuses[cubeId] = submission.get('condition'))
    : (delete statuses[cubeId])
  disassembly.statuses = $cleanDict(statuses)
  order.set({ disassembly })
  order.save(null, { useMasterKey: true })

  // cleanup unused cube photos
  const scope = ['disassembly', 'TL', submission.get('taskList').id].join('-')
  const formPhotoIds = (submission.get('photos') || []).map(photo => photo.id).flat()
  await $query('CubePhoto')
    .equalTo('cubeId', submission.get('cube').id)
    .equalTo('scope', scope)
    .notContainedIn('objectId', formPhotoIds)
    .eachBatch(async (records) => {
      for (const record of records) {
        await record.destroy({ useMasterKey: true })
      }
    }, { useMasterKey: true })
})

async function fetchSubmission (taskListId, cubeId, SubmissionClass, submissionId) {
  const taskList = await $getOrFail(TaskList, taskListId)
  const cube = await $getOrFail('Cube', cubeId)
  const submission = submissionId
    ? await $getOrFail(SubmissionClass, submissionId)
    : await $query(SubmissionClass)
      .equalTo('taskList', taskList)
      .equalTo('cube', cube)
      .first({ useMasterKey: true }) || new SubmissionClass({ taskList, cube })
  return { taskList, cube, submission }
}

async function notifySubmissionRejected (type, submission, cube, rejectionReason) {
  const placeKey = [cube.get('state').id, cube.get('ort')].join(':')
  return $notify({
    user: submission.get('scout'),
    identifier: 'task-submission-rejected',
    data: { type, cubeId: cube.id, submissionId: submission.id, placeKey, rejectionReason }
  })
}

function removeRejectedNotifications (type, submission) {
  return $query('Notification')
    .equalTo('identifier', 'task-submission-rejected')
    .equalTo('data.submissionId', submission.id)
    .equalTo('data.type', type)
    .each(record => record.destroy({ useMasterKey: true }), { useMasterKey: true })
}

Parse.Cloud.define('scout-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, form, approve }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, ScoutSubmission, submissionId)
  submission.set('status', 'pending')
  !approve && submission.set('scout', user)

  // update submission time if not submitted before or was rejected
  if (!submission.get('lastSubmittedAt') || submission.get('status') === 'rejected') {
    submission.set('lastSubmittedAt', new Date())
  }

  // make sure the cube is added to the list if found
  const cubeIds = taskList.get('cubeIds') || []
  if (!cubeIds.includes(cubeId)) {
    cubeIds.push(cubeId)
    const scoutAddedCubeIds = taskList.get('scoutAddedCubeIds') || []
    scoutAddedCubeIds.push(cubeId)
    taskList.set({ cubeIds, scoutAddedCubeIds })
  }

  form.notFound = Boolean(form.notFound)
  const condition = form.notFound ? 'nf' : 'true'
  let changes
  if (submissionId) {
    changes = $changes(submission.get('form'), form, true)
    delete changes.photoIds
    delete changes.photoPos
  }
  const photos = await $query('CubePhoto').containedIn('objectId', form.photoIds).find({ useMasterKey: true })
  submission.set({ form, condition, photos })

  await submission.save(null, { useMasterKey: true })
  taskList.set({ status: 3 })
  const audit = { user, fn: 'scout-submission-submit', data: { cubeId, changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Scouting erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('scout-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(ScoutSubmission, submissionId, ['taskList', 'cube', 'photos'])
  const cube = submission.get('cube')
  const cubeId = cube.id
  // if not found, soft delete the cube
  if (submission.get('form').notFound) {
    cube.set('dAt', new Date())
    await $saveWithEncode(cube, null, { useMasterKey: true })
  } else {
    // save details to cube and approve photos
    const photos = submission.get('photos')
    await Parse.Object.saveAll(photos.map(photo => photo.set('approved', true)), { useMasterKey: true })
    const form = submission.get('form')
    const { photoPos, address, stateId, htId, media } = form
    photoPos.p1 && !cube.get('p1') && cube.set('p1', photos.find(photo => photo.id === photoPos.p1))
    photoPos.p2 && !cube.get('p2') && cube.set('p2', photos.find(photo => photo.id === photoPos.p2))
    const { str, hsnr, ort, plz } = address
    cube.set({ str, hsnr, ort, plz })
    cube.set('state', $parsify('State', stateId))
    cube.set('media', media)
    htId && cube.set('ht', $parsify('HousingType', htId))
    cube.set('sides', form.sides)
    const scoutData = $cleanDict(form.scoutData)
    scoutData ? cube.set('scoutData', scoutData) : cube.unset('scoutData')
    cube.set('vAt', new Date())
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }

  submission.set({ status: 'approved' })
  const audit = { user, fn: 'scout-submission-approve', data: { cubeId } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('scout', submission)
  return { message: 'Scouting genehmigt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('scout-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(ScoutSubmission, submissionId, ['taskList', 'cube'])
  const taskList = submission.get('taskList')
  if (taskList.get('status') >= 4) {
    throw new Error('Formulare aus erledigte Scouting Abfahrtsliste können nicht mehr abgelehnt werden.')
  }
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const cubeId = cube.id
  if (submission.get('form').notFound) {
    cube.unset('dAt')
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }
  const audit = { user, fn: 'scout-submission-reject', data: { cubeId, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  // taskList.get('status') !== 3 && taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  // Notify scout if the list is in progress
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('scout', submission, cube, rejectionReason)
  return { message: 'Scouting abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, beforePhotoIds, afterPhotoIds, comments, disassemblyId, approve }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, ControlSubmission, submissionId)
  if (!submission.get('orderKey')) {
    const cubeOrder = await $query('Cube').select('order').equalTo('objectId', cubeId).first({ useMasterKey: true }).then(cube => cube.get('order'))
    const orderKey = [cubeOrder.className, cubeOrder.objectId].join('$')
    submission.set('orderKey', orderKey)
  }
  submission.set('status', 'pending')
  !approve && submission.set('scout', user)
  // update submission time if not submitted before or was rejected
  if (!submission.get('lastSubmittedAt') || submission.get('status') === 'rejected') {
    submission.set('lastSubmittedAt', new Date())
  }

  if (condition !== 'no_ad') {
    comments = null
  }
  let disassembly
  if (condition === 'disassembled' && disassemblyId) {
    disassembly = await $getOrFail('DisassemblySubmission', disassemblyId)
  }
  let changes
  if (submission.id) {
    changes = $changes(submission, { condition, comments, disassembly })
  }
  submission.set({ condition, comments })
  disassembly ? submission.set({ disassembly }) : submission.unset('disassembly')

  const pointerPhotos = ids => ids?.length ? ids.map(id => $pointer('CubePhoto', id)) : null
  submission.set('beforePhotos', pointerPhotos(beforePhotoIds))
  submission.set('afterPhotos', pointerPhotos(afterPhotoIds))
  await submission.save(null, { useMasterKey: true })
  taskList.set({ status: 3 })
  const audit = { user, fn: 'control-submission-submit', data: { cubeId, changes } }
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Kontrolle erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(ControlSubmission, submissionId, ['taskList', 'cube'])
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'control-submission-approve', data: { cubeId } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('control', submission)
  return { message: 'Kontrolle genehmigt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(ControlSubmission, submissionId, ['taskList', 'cube'])
  const taskList = submission.get('taskList')
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const audit = { user, fn: 'control-submission-reject', data: { cubeId: cube.id, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  // taskList.get('status') !== 3 && taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('control', submission, cube, rejectionReason)
  return { message: 'Kontrolle abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, photoIds, comments, approve }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, DisassemblySubmission, submissionId, ['disassembly'])
  const disassembly = taskList.get('disassembly')

  submission.set('status', 'pending')
  !approve && submission.set('scout', user)

  // update submission time if not submitted before or was rejected
  if (!submission.get('lastSubmittedAt') || submission.get('status') === 'rejected') {
    submission.set('lastSubmittedAt', new Date())
  }

  let changes
  if (condition === 'true') {
    comments = null
  }
  if (submission.id) {
    changes = $changes(submission, { condition, comments })
  }
  const photos = await $query('CubePhoto').containedIn('objectId', photoIds).find({ useMasterKey: true })
  submission.set({ condition, photos, comments })
  const audit = { user, fn: 'disassembly-submission-submit', data: { cubeId, changes } }
  await submission.save(null, { useMasterKey: true })

  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  // control-disassembled
  const order = disassembly.get('order')
  const orderKey = [order.className, order.id].join('$')
  const controlIds = await $query('Control')
    .greaterThan('status', 0)
    .equalTo(`cubeOrderKeys.${cubeId}`, orderKey)
    .distinct('objectId', { useMasterKey: true })
  await $query('TaskList')
    .equalTo('type', 'control')
    .matchesQuery('control', $query('Control').containedIn('objectId', controlIds))
    .equalTo('cubeIds', cubeId)
    .equalTo(`statuses.${cubeId}`, null) // no activity yet
    .each(async (list) => {
      await Parse.Cloud.run('control-submission-submit', {
        id: list.id,
        cubeId,
        condition: 'disassembled',
        disassemblyId: submission.id
      }, { sessionToken: user.getSessionToken() })
    }, { useMasterKey: true })
  return { message: 'Demontage erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(DisassemblySubmission, submissionId, ['taskList', 'cube', 'disassembly.contract', 'disassembly.booking'])
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'disassembly-submission-approve', data: { cubeId } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('disassembly', submission)

  // control-disassembled
  const controlSubmission = await $query(ControlSubmission)
    .equalTo('disassembly', submission)
    .first({ useMasterKey: true })
  controlSubmission && await Parse.Cloud.run('control-submission-approve', {
    id: controlSubmission.id
  }, { sessionToken: user.getSessionToken() })
  return { message: 'Demontage genehmigt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(DisassemblySubmission, submissionId, ['taskList', 'cube'])
  const taskList = submission.get('taskList')
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const audit = { user, fn: 'disassembly-submission-reject', data: { cubeId: cube.id } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  // taskList.get('status') !== 3 && taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('disassembly', submission, cube, rejectionReason)
  return { message: 'Demontage abgelehnt.', data: submission }
}, { requireUser: true })
