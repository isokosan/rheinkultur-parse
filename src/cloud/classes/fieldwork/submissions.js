const TaskList = Parse.Object.extend('TaskList')
const ScoutSubmission = Parse.Object.extend('ScoutSubmission')
const ControlSubmission = Parse.Object.extend('ControlSubmission')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')

Parse.Cloud.afterSave(ControlSubmission, async ({ object: submission }) => {
  // cleanup unused cube photos
  const scopes = ['before', 'after'].map(type => ['control', type, 'TL', submission.get('taskList').id].join('-'))
  const formPhotoIds = ['beforePhotos', 'afterPhotos'].map(key => submission.get(key)?.map(photo => photo.id)).flat()
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
  return { message: 'Scouting genehmigt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('scout-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(ScoutSubmission, submissionId, ['taskList', 'cube'])
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const cubeId = cube.id
  if (submission.get('form').notFound) {
    cube.unset('dAt')
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }
  const audit = { user, fn: 'scout-submission-reject', data: { cubeId, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  const placeKey = [cube.get('state').id, cube.get('ort')].join(':')

  await $notify({
    user: submission.get('scout'),
    identifier: 'task-submission-rejected',
    data: { type: 'scout', cubeId, placeKey, rejectionReason }
  })
  return { message: 'Scouting abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, beforePhotoIds, afterPhotoIds, comments, disassemblyId, approve }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, ControlSubmission, submissionId)

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
  return { message: 'Kontrolle genehmigt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(ControlSubmission, submissionId, ['taskList', 'cube'])
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const audit = { user, fn: 'control-submission-reject', data: { cubeId: cube.id, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  const placeKey = [cube.get('state').id, cube.get('ort')].join(':')

  await $notify({
    user: submission.get('scout'),
    identifier: 'task-submission-rejected',
    data: { type: 'control', cubeId: cube.id, placeKey, rejectionReason }
  })
  return { message: 'Kontrolle abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, photoId, comments, approve }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, DisassemblySubmission, submissionId)

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
  submission.set({
    condition,
    photo: photoId ? await $getOrFail('FileObject', photoId) : null,
    comments
  })
  const audit = { user, fn: 'disassembly-submission-submit', data: { cubeId, changes } }
  await submission.save(null, { useMasterKey: true })

  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  // control-disassembled
  const controlList = await $query('TaskList')
    .equalTo('type', 'control')
    .equalTo('cubeIds', cubeId)
    .first({ sessionToken: user.getSessionToken() })
  controlList && await Parse.Cloud.run('control-submission-submit', {
    id: controlList.id,
    cubeId,
    condition: 'disassembled',
    disassemblyId: submission.id
  }, { sessionToken: user.getSessionToken() })
  return { message: 'Demontage erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(DisassemblySubmission, submissionId, ['taskList', 'cube', 'disassembly.contract', 'disassembly.booking'])
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'disassembly-submission-approve', data: { cubeId } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })

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
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const audit = { user, fn: 'disassembly-submission-reject', data: { cubeId: cube.id } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  const placeKey = [cube.get('state').id, cube.get('ort')].join(':')

  await $notify({
    user: submission.get('scout'),
    identifier: 'task-submission-rejected',
    data: { type: 'disassembly', cubeId: cube.id, placeKey, rejectionReason }
  })
  return { message: 'Demontage abgelehnt.', data: submission }
}, { requireUser: true })
