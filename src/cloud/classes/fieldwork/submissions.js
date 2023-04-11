const TaskList = Parse.Object.extend('TaskList')
const ScoutSubmission = Parse.Object.extend('ScoutSubmission')
const ControlSubmission = Parse.Object.extend('ControlSubmission')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')

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

Parse.Cloud.define('scout-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, form, photoIds, comments }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, ScoutSubmission, submissionId)
  submission.set({ scout: user, status: 'pending' })

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
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  if (user.get('accType') === 'admin') {
    return Parse.Cloud.run('scout-submission-approve', { id: submission.id }, { sessionToken: user.get('sessionToken') })
  }
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
    const { str, hsnr, ort, plz } = form.address
    cube.set({ str, hsnr, ort, plz })
    const { stateId, htId, media } = form
    cube.set('state', $parsify('State', stateId))
    cube.set('media', media)
    cube.set('ht', $parsify('HousingType', htId))
    const { sides } = form
    cube.set({ sides, vAt: new Date() })
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

Parse.Cloud.define('control-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, beforePhotoId, afterPhotoId, comments, disassemblyId }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, ControlSubmission, submissionId)
  submission.set({ scout: user, status: 'pending' })
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
  submission.set({
    scout: user,
    status: 'pending',
    condition,
    comments
  })
  disassembly ? submission.set({ disassembly }) : submission.unset('disassembly')

  submission.set('beforePhoto', beforePhotoId ? await $getOrFail('FileObject', beforePhotoId) : null)
  submission.set('afterPhoto', afterPhotoId ? await $getOrFail('FileObject', afterPhotoId) : null)
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

Parse.Cloud.define('disassembly-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, photoId, comments }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, DisassemblySubmission, submissionId)
  submission.set({ scout: user, status: 'pending' })
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
  return { message: 'Abbau erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(DisassemblySubmission, submissionId, ['taskList', 'cube'])
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
  return { message: 'Abbau genehmigt.', data: submission }
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
  return { message: 'Abbau abgelehnt.', data: submission }
}, { requireUser: true })
