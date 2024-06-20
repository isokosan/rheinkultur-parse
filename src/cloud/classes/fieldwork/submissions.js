const { TASK_LIST_IN_PROGRESS_STATUSES } = require('@/schema/enums')
const { ensureUniqueField } = require('@/utils')

const TaskList = Parse.Object.extend('TaskList')
const ScoutSubmission = Parse.Object.extend('ScoutSubmission')
const AssemblySubmission = Parse.Object.extend('AssemblySubmission')
const ControlSubmission = Parse.Object.extend('ControlSubmission')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')
const SpecialFormatSubmission = Parse.Object.extend('SpecialFormatSubmission')
const CustomTaskSubmission = Parse.Object.extend('CustomTaskSubmission')

// register before save unique field checks
for (const submissionClass of [ScoutSubmission, ControlSubmission, DisassemblySubmission, SpecialFormatSubmission, CustomTaskSubmission]) {
  Parse.Cloud.beforeSave(submissionClass, async ({ object }) => {
    object.isNew() && await ensureUniqueField(object, 'taskList', 'cube')
  })
}

// KNOWN ISSUE: scout submission has comments under form object, comment field is empty
Parse.Cloud.afterFind(ControlSubmission, async ({ query, objects: submissions }) => {
  if (query._include.includes('orders')) {
    const orderKeys = [...new Set(submissions.map(submission => submission.get('orderKey')))]
    const orders = {}
    for (const className of ['Contract', 'Booking']) {
      const ids = orderKeys.filter(key => key.startsWith(className)).map(key => key.split('$')[1])
      const query = $query(className)
        .containedIn('objectId', ids)
        .limit(ids.length)
        .select(['no', 'status', 'motive', 'externalOrderNo', 'campaignNo', 'startsAt', 'endsAt', 'initialDuration', 'extendedDuration', 'earlyCancellations'])
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

async function notifySubmissionRejected (type, taskList, submission, cube, rejectionReason) {
  const placeKey = cube.get('pk')
  return Promise.all((taskList.get('scouts') || []).map((scout) => $notify({
    user: scout,
    identifier: 'task-submission-rejected',
    data: { type, cubeId: cube.id, taskListId: taskList.id, submissionId: submission.id, placeKey, rejectionReason }
  })))
}

function removeRejectedNotifications (type, submission) {
  return $query('Notification')
    .equalTo('identifier', 'task-submission-rejected')
    .equalTo('data.submissionId', submission.id)
    .equalTo('data.type', type)
    .each(record => record.destroy({ useMasterKey: true }), { useMasterKey: true })
}

// scout manager or fieldworkmanager
function validateApprove (user) {
  const isFieldworkManager = user?.get('permissions').includes('manage-fieldwork')
  const isScoutManager = user?.get('permissions').includes('manage-scouts')
  if (!isFieldworkManager && !isScoutManager) {
    throw new Error('Nur Fieldwork Manager oder Scout Manager können genehmigen.')
  }
}

Parse.Cloud.define('scout-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, form, approve }, user }) => {
  approve && validateApprove(user)
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, ScoutSubmission, submissionId)
  submission.set('status', 'pending')

  // !approve is for the case where scouts are using the scout app, in which case the scout should always be updated
  // in the other case, the submission is new so no scout is present, as the approving admin will set as the  scout
  const manual = (approve && !submission.id) || undefined
  if (manual || !approve) {
    submission.set('scout', user).set('lastSubmittedAt', new Date())
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
  const comments = form.comments
  let changes
  if (submissionId) {
    changes = $changes(submission.get('form'), form, true)
    delete changes.photoIds
    delete changes.photoPos
    delete form.comments
  }

  const photos = await $query('CubePhoto').containedIn('objectId', form.photoIds).find({ useMasterKey: true })
  submission.set({ form, condition, photos, comments })

  await submission.save(null, { useMasterKey: true })
  const audit = { fn: 'scout-submission-submit', data: { cubeId, changes, manual, approved: approve || undefined } }
  if (approve) {
    return Parse.Cloud.run('scout-submission-approve', { id: submission.id, auditCarry: audit }, { sessionToken: user.getSessionToken() })
  }
  audit.user = user
  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Scouting erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('scout-submission-approve', async ({ params: { id: submissionId, auditCarry }, user }) => {
  validateApprove(user)
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
    const features = $cleanDict(form.features)
    features ? cube.set({ features }) : cube.unset('features')
    cube.set('vAt', new Date())
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }

  submission.set({ status: 'approved' })
  const audit = auditCarry || { fn: 'scout-submission-approve', data: { cubeId } }
  audit.user = user
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('scout', submission)
  return {
    message: auditCarry ? 'Scouting gespeichert und genehmigt.' : 'Scouting genehmigt.',
    data: submission
  }
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
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('scout', taskList, submission, cube, rejectionReason)
  return { message: 'Scouting abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('assembly-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, result, photoIds, comments, approve }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, AssemblySubmission, submissionId)
  submission.set('status', 'pending')
  // !approve is for the case where scouts are using the scout app, in which case the scout should always be updated
  // in the other case, the submission is new so no scout is present, as the approving admin will set as the  scout
  const manual = (approve && !submission.id) || undefined
  if (manual || !approve) {
    submission.set('scout', user).set('lastSubmittedAt', new Date())
  }

  let changes
  if (submission.id) {
    changes = $changes(submission, { result, comments })
  }
  const photos = await $query('CubePhoto').containedIn('objectId', photoIds).find({ useMasterKey: true })
  submission.set({ result, photos, comments })
  await submission.save(null, { useMasterKey: true })
  const audit = { fn: 'assembly-submission-submit', data: { cubeId, changes, manual, approved: approve || undefined } }
  if (approve) {
    return Parse.Cloud.run('assembly-submission-approve', { id: submission.id, auditCarry: audit }, { sessionToken: user.getSessionToken() })
  }
  audit.user = user
  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Montage eingereicht.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('assembly-submission-approve', async ({ params: { id: submissionId, auditCarry }, user }) => {
  validateApprove(user)
  const submission = await $getOrFail(AssemblySubmission, submissionId, ['taskList', 'cube', 'assembly.contract', 'assembly.booking'])
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = auditCarry || { fn: 'assembly-submission-approve', data: { cubeId } }
  audit.user = user
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('assembly', submission)
  return {
    message: auditCarry ? 'Montage gespeichert und genehmigt.' : 'Montage genehmigt.',
    data: submission
  }
}, { requireUser: true })

Parse.Cloud.define('assembly-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(AssemblySubmission, submissionId, ['taskList', 'cube'])
  const taskList = submission.get('taskList')
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const audit = { user, fn: 'assembly-submission-reject', data: { cubeId: cube.id } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('assembly', taskList, submission, cube, rejectionReason)
  return { message: 'Montage abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, pruned, painted, missingDisassembled, beforePhotoIds, afterPhotoIds, comments, disassemblyId, approve }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, ControlSubmission, submissionId)
  if (!submission.get('orderKey')) {
    // find orderKey from control
    const orderKey = submission.get('taskList').get('control').get('cubeOrderKeys')?.[cubeId]
    if (!orderKey) {
      consola.error(`Cannot find cube order key in control submission ${submissionId}, approve: ${approve}`)
    }
    submission.set('orderKey', orderKey)
  }

  submission.set('status', 'pending')
  // !approve is for the case where scouts are using the scout app, in which case the scout should always be updated
  // in the other case, the submission is new so no scout is present, as the approving admin will set as the  scout
  const manual = (approve && !submission.id) || undefined
  if (manual || !approve) {
    submission.set('scout', user).set('lastSubmittedAt', new Date())
  }

  let disassembly
  if (condition === 'disassembled' && disassemblyId) {
    disassembly = await $getOrFail('DisassemblySubmission', disassemblyId)
  }
  if (condition !== 'missing' && missingDisassembled) {
    missingDisassembled = undefined
  }
  let changes
  if (submission.id) {
    changes = $changes(submission, { condition, pruned, painted, missingDisassembled, comments, disassembly })
  }
  submission.set({ condition, form: { pruned, painted, missingDisassembled }, comments })
  disassembly ? submission.set({ disassembly }) : submission.unset('disassembly')

  const pointerPhotos = ids => ids?.length ? ids.map(id => $pointer('CubePhoto', id)) : null
  submission.set('beforePhotos', pointerPhotos(beforePhotoIds))
  submission.set('afterPhotos', pointerPhotos(afterPhotoIds))
  await submission.save(null, { useMasterKey: true })
  const audit = { fn: 'control-submission-submit', data: { cubeId, changes, manual, approved: approve || undefined } }
  if (approve) {
    return Parse.Cloud.run('control-submission-approve', { id: submission.id, auditCarry: audit }, { sessionToken: user.getSessionToken() })
  }
  audit.user = user
  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Kontrolle erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('control-submission-approve', async ({ params: { id: submissionId, auditCarry }, user }) => {
  validateApprove(user)
  const submission = await $getOrFail(ControlSubmission, submissionId, ['taskList', 'cube'])
  const cubeId = submission.get('cube').id
  submission.set({ status: 'approved' })
  const audit = auditCarry || { fn: 'control-submission-approve', data: { cubeId } }
  audit.user = user
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('control', submission)
  return {
    message: auditCarry ? 'Kontrolle gespeichert und genehmigt.' : 'Kontrolle genehmigt.',
    data: submission
  }
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
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('control', taskList, submission, cube, rejectionReason)
  return { message: 'Kontrolle abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, condition, photoIds, comments, approve }, user }) => {
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, DisassemblySubmission, submissionId, ['disassembly'])
  const disassembly = taskList.get('disassembly')

  submission.set('status', 'pending')
  // !approve is for the case where scouts are using the scout app, in which case the scout should always be updated
  // in the other case, the submission is new so no scout is present, as the approving admin will set as the  scout
  const manual = (approve && !submission.id) || undefined
  if (manual || !approve) {
    submission.set('scout', user).set('lastSubmittedAt', new Date())
  }

  let changes
  if (submission.id) {
    changes = $changes(submission, { condition, comments })
  }
  const photos = await $query('CubePhoto').containedIn('objectId', photoIds).find({ useMasterKey: true })
  submission.set({ condition, photos, comments })
  await submission.save(null, { useMasterKey: true })

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
    .each(list => Parse.Cloud.run('control-submission-submit', {
      id: list.id,
      cubeId,
      condition: 'disassembled',
      disassemblyId: submission.id,
      approve
    }, { sessionToken: user.getSessionToken() }), { useMasterKey: true })

  const audit = { fn: 'disassembly-submission-submit', data: { cubeId, changes, manual, approved: approve || undefined } }
  if (approve) {
    return Parse.Cloud.run('disassembly-submission-approve', { id: submission.id, auditCarry: audit }, { sessionToken: user.getSessionToken() })
  }
  audit.user = user
  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Demontage erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-approve', async ({ params: { id: submissionId, auditCarry }, user }) => {
  validateApprove(user)
  const submission = await $getOrFail(DisassemblySubmission, submissionId, ['taskList', 'cube', 'disassembly.contract', 'disassembly.booking'])
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = auditCarry || { fn: 'disassembly-submission-approve', data: { cubeId } }
  audit.user = user
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('disassembly', submission)

  // control-disassembled
  await $query(ControlSubmission)
    .equalTo('disassembly', submission)
    .notEqualTo('status', 'approved')
    .each(controlSubmission => Parse.Cloud.run('control-submission-approve', { id: controlSubmission.id }, { sessionToken: user.getSessionToken() }), { useMasterKey: true })
  return {
    message: auditCarry ? 'Demontage gespeichert und genehmigt.' : 'Demontage genehmigt.',
    data: submission
  }
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
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('disassembly', taskList, submission, cube, rejectionReason)
  return { message: 'Demontage abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('special-format-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, form, approve }, user }) => {
  approve && validateApprove(user)
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, SpecialFormatSubmission, submissionId)
  submission.set('status', 'pending')

  // !approve is for the case where scouts are using the scout app, in which case the scout should always be updated
  // in the other case, the submission is new so no scout is present, as the approving admin will set as the  scout
  const manual = (approve && !submission.id) || undefined
  if (manual || !approve) {
    submission.set('scout', user).set('lastSubmittedAt', new Date())
  }

  form.notFound = Boolean(form.notFound)
  const quantity = parseInt(form.notFound ? 0 : form.quantity)
  const comments = form.comments

  let changes
  if (submissionId) {
    changes = $changes(submission.get('form'), form, true)
    delete changes.photoIds
    delete changes.photoPos
    delete form.comments
  }

  const photos = await $query('CubePhoto').containedIn('objectId', form.photoIds).find({ useMasterKey: true })
  submission.set({ form, quantity, photos, comments })

  await submission.save(null, { useMasterKey: true })
  const audit = { fn: 'special-format-submission-submit', data: { cubeId, changes, manual, approved: approve || undefined } }
  if (approve) {
    return Parse.Cloud.run('special-format-submission-approve', { id: submission.id, auditCarry: audit }, { sessionToken: user.getSessionToken() })
  }
  audit.user = user
  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Einreichung erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('special-format-submission-approve', async ({ params: { id: submissionId, auditCarry }, user }) => {
  validateApprove(user)
  const submission = await $getOrFail(SpecialFormatSubmission, submissionId, ['taskList', 'cube'])
  const cube = submission.get('cube')
  const cubeId = submission.get('cube').id

  // if not found, soft delete the cube
  if (submission.get('form').notFound) {
    cube.set('dAt', new Date())
    await $saveWithEncode(cube, null, { useMasterKey: true })
  } else {
    // save details to cube and approve photos
    const { htId, media } = submission.get('form')
    cube.set('media', media)
    htId && cube.set('ht', $parsify('HousingType', htId))
    // cube.set('vAt', new Date())
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }

  submission.set({ status: 'approved' })
  const audit = auditCarry || { fn: 'special-format-submission-approve', data: { cubeId } }
  audit.user = user
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('special-format', submission)
  return {
    message: auditCarry ? 'Sonderformat gespeichert und genehmigt.' : 'Sonderformat genehmigt.',
    data: submission
  }
}, { requireUser: true })

Parse.Cloud.define('special-format-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(SpecialFormatSubmission, submissionId, ['taskList', 'cube'])
  const taskList = submission.get('taskList')
  if (taskList.get('status') >= 4) {
    throw new Error('Formulare aus erledigte Abfahrtsliste können nicht mehr abgelehnt werden.')
  }
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const cubeId = cube.id
  if (submission.get('form').notFound) {
    cube.unset('dAt')
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }
  const audit = { user, fn: 'special-format-submission-reject', data: { cubeId, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  // Notify scout if the list is in progress
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('special-format', taskList, submission, cube, rejectionReason)
  return { message: 'Scouting abgelehnt.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('custom-task-submission-submit', async ({ params: { id: taskListId, cubeId, submissionId, form, approve }, user }) => {
  approve && validateApprove(user)
  const { taskList, submission } = await fetchSubmission(taskListId, cubeId, CustomTaskSubmission, submissionId)
  submission.set('status', 'pending')

  // !approve is for the case where scouts are using the scout app, in which case the scout should always be updated
  // in the other case, the submission is new so no scout is present, as the approving admin will set as the  scout
  const manual = (approve && !submission.id) || undefined
  if (manual || !approve) {
    submission.set('scout', user).set('lastSubmittedAt', new Date())
  }

  form.notFound = Boolean(form.notFound)
  const comments = form.comments

  let changes
  if (submissionId) {
    changes = $changes(submission.get('form'), form, true)
    delete changes.photoIds
    delete changes.photoPos
    delete form.comments
  }

  const photos = await $query('CubePhoto').containedIn('objectId', form.photoIds).find({ useMasterKey: true })
  submission.set({ form, photos, comments })

  await submission.save(null, { useMasterKey: true })
  const audit = { fn: 'custom-task-submission-submit', data: { cubeId, changes, manual, approved: approve || undefined } }
  if (approve) {
    return Parse.Cloud.run('custom-task-submission-approve', { id: submission.id, auditCarry: audit }, { sessionToken: user.getSessionToken() })
  }
  audit.user = user
  taskList.set({ status: 3 })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  return { message: 'Einreichung erfolgreich.', data: submission }
}, { requireUser: true })

Parse.Cloud.define('custom-task-submission-approve', async ({ params: { id: submissionId, auditCarry }, user }) => {
  validateApprove(user)
  const submission = await $getOrFail(CustomTaskSubmission, submissionId, ['taskList', 'cube'])
  const cube = submission.get('cube')
  const cubeId = submission.get('cube').id

  // if not found, soft delete the cube
  if (submission.get('form').notFound) {
    cube.set('dAt', new Date())
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }

  submission.set({ status: 'approved' })
  const audit = auditCarry || { fn: 'custom-task-submission-approve', data: { cubeId } }
  audit.user = user
  await submission.save(null, { useMasterKey: true })
  await submission.get('taskList').save(null, { useMasterKey: true, context: { audit } })
  await removeRejectedNotifications('custom-task', submission)
  return {
    message: auditCarry ? 'Aufgabe gespeichert und genehmigt.' : 'Aufgabe genehmigt.',
    data: submission
  }
}, { requireUser: true })

Parse.Cloud.define('custom-task-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(CustomTaskSubmission, submissionId, ['taskList', 'cube'])
  const taskList = submission.get('taskList')
  if (taskList.get('status') >= 4) {
    throw new Error('Formulare aus erledigte Abfahrtsliste können nicht mehr abgelehnt werden.')
  }
  submission.set({ status: 'rejected', rejectionReason })
  const cube = submission.get('cube')
  const cubeId = cube.id
  if (submission.get('form').notFound) {
    cube.unset('dAt')
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }
  const audit = { user, fn: 'custom-task-submission-reject', data: { cubeId, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await taskList.save(null, { useMasterKey: true, context: { audit } })
  // Notify scout if the list is in progress
  TASK_LIST_IN_PROGRESS_STATUSES.includes(taskList.get('status')) && await notifySubmissionRejected('custom-task', taskList, submission, cube, rejectionReason)
  return { message: 'Aufgabe abgelehnt.', data: submission }
}, { requireUser: true })

module.exports.removeRejectedNotifications = removeRejectedNotifications
