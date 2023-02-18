const { capitalize } = require('lodash')
const { departureLists: { normalizeFields } } = require('@/schema/normalizers')

const DepartureList = Parse.Object.extend('DepartureList')
const ScoutSubmission = Parse.Object.extend('ScoutSubmission')
const ControlSubmission = Parse.Object.extend('ControlSubmission')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')

Parse.Cloud.beforeSave(DepartureList, async ({ object: departureList, context: { countCubes } }) => {
  if (departureList.isNew()) {
    if (!departureList.get('name')) {
      let name = ''
      const briefing = departureList.get('briefing')
      if (briefing) {
        await briefing.fetch({ useMasterKey: true })
        name += briefing.get('name')
        name += ' '
      }
      const control = departureList.get('control')
      if (control) {
        await control.fetch({ useMasterKey: true })
        name += control.get('name')
        name += ' '
      }
      departureList.set('name', name)
    }
  }

  const cubeIds = [...new Set(departureList.get('cubeIds') || [])]
  cubeIds.sort()
  departureList.set('cubeIds', cubeIds)
  departureList.set('cubeCount', cubeIds.length)

  if (countCubes) {
    const submissionClass = capitalize(departureList.get('type')) + 'Submission'

    const approvedCubeIds = await $query(submissionClass)
      .equalTo('departureList', departureList)
      .equalTo('status', 'approved')
      .notEqualTo('form.notFound', true)
      .distinct('cube', { useMasterKey: true })
      .then(cubes => cubes.map(cube => cube.objectId))
    approvedCubeIds.push(...(departureList.get('adminApprovedCubeIds') || []))

    const pendingCubeIds = await $query(submissionClass)
      .equalTo('departureList', departureList)
      .equalTo('status', null)
      .distinct('cube', { useMasterKey: true })
      .then(cubes => cubes.map(cube => cube.objectId))
    departureList.set('pendingCubeIds', pendingCubeIds)
    departureList.set('pendingCubeCount', pendingCubeIds.length)

    departureList.set('approvedCubeIds', [...new Set(approvedCubeIds)])
    departureList.set('approvedCubeCount', approvedCubeIds.length)

    const rejectedCubeIds = await $query(submissionClass)
      .equalTo('departureList', departureList)
      .equalTo('status', 'rejected')
      .distinct('cube', { useMasterKey: true })
      .then(cubes => cubes.map(cube => cube.objectId))
    departureList.set('rejectedCubeIds', rejectedCubeIds)
    departureList.set('rejectedCubeCount', rejectedCubeIds.length)
  }
})

Parse.Cloud.afterSave(DepartureList, ({ object: departureList, context: { audit, notifyScout } }) => {
  $audit(departureList, audit)
  notifyScout && $notify({
    user: departureList.get('scout'),
    message: `You have been assigned to scout ${departureList.get('name')}`,
    uri: `/departure-lists/${departureList.id}`,
    data: { departureListId: departureList.id }
  })
})

Parse.Cloud.beforeFind(DepartureList, async ({ query, user, master }) => {
  query._include.includes('all') && query.include(['briefing', 'control', 'disassembly', 'submissions'])
  if (master) { return }
  if (user.get('accRoles')?.includes('manage-scouts')) {
    user.get('company') && query
      .equalTo('manager', user)
      .containedIn('status', ['appointed', 'assigned', 'in_progress', 'completed'])
  }
  if (user.get('accType') === 'scout') {
    query.equalTo('scout', user).containedIn('status', ['assigned', 'in_progress', 'completed'])
  }
})

Parse.Cloud.afterFind(DepartureList, async ({ objects: departureLists, query }) => {
  for (const departureList of departureLists) {
    if (query._include.includes('submissions')) {
      let submissions
      if (departureList.get('type') === 'scout') {
        submissions = await $query(ScoutSubmission).equalTo('departureList', departureList).find({ useMasterKey: true })
      }
      if (departureList.get('type') === 'control') {
        submissions = await $query(ControlSubmission).equalTo('departureList', departureList).find({ useMasterKey: true })
      }
      if (departureList.get('type') === 'disassembly') {
        submissions = await $query(DisassemblySubmission).equalTo('departureList', departureList).find({ useMasterKey: true })
      }
      departureList.set('submissions', submissions)
    }
  }
  return departureLists
})

Parse.Cloud.afterDelete(DepartureList, $deleteAudits)

Parse.Cloud.define('departure-list-create', async ({ params, user }) => {
  const {
    type,
    name,
    quota,
    dueDate,
    scoutId
  } = normalizeFields(params)

  const departureList = new DepartureList({
    type,
    name,
    quota,
    dueDate,
    scout: scoutId ? await $getOrFail('_User', scoutId) : undefined
  })
  const audit = { user, fn: 'departure-list-create' }
  return departureList.save(null, { useMasterKey: true, context: { audit } })
}, {
  requireUser: true,
  fields: {
    type: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    }
  }
})

Parse.Cloud.define('departure-list-update', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const {
    cubeIds,
    quota,
    dueDate,
    scoutId,
    managerId
  } = normalizeFields({ ...params, type: departureList.get('type') })

  const cubeChanges = $cubeChanges(departureList, cubeIds)
  cubeChanges && departureList.set({ cubeIds })

  const changes = $changes(departureList, { quota, dueDate })
  departureList.set({ quota, dueDate })

  if (scoutId !== departureList.get('scout')?.id) {
    changes.scoutId = [departureList.get('scout')?.id, scoutId]
    departureList.set('scout', scoutId ? await $getOrFail(Parse.User, scoutId) : null)
  }
  if (managerId !== departureList.get('manager')?.id) {
    changes.managerId = [departureList.get('manager')?.id, managerId]
    departureList.set('manager', managerId ? await $getOrFail(Parse.User, managerId) : null)
  }

  const audit = { user, fn: 'departure-list-update', data: { changes, cubeChanges } }
  const notifyScout = Boolean(departureList.get('status') && scoutId && changes.scoutId)
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScout } })
  return `Scout gespeichert${notifyScout ? ' und notified.' : '.'}`
}, { requireUser: true })

Parse.Cloud.define('departure-list-update-manager', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const { managerId } = normalizeFields(params)
  if (managerId === departureList.get('manager')?.id) {
    throw new Error('Keine Änderungen')
  }
  const changes = { managerId: [departureList.get('manager')?.id, managerId] }
  departureList.set('manager', managerId ? await $getOrFail(Parse.User, managerId) : null)
  const manager = managerId ? $parsify(Parse.User, managerId) : null
  departureList.set({ manager })
  const audit = { user, fn: 'departure-list-update', data: { changes } }
  const notifyManager = false
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyManager } })
  return {
    data: departureList.get('manager'),
    message: 'Manager gespeichert.'
  }
}, { requireUser: true })

Parse.Cloud.define('departure-list-update-scout', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const { scoutId } = normalizeFields(params)
  if (scoutId === departureList.get('scout')?.id) {
    throw new Error('Keine Änderungen')
  }
  const changes = { scoutId: [departureList.get('scout')?.id, scoutId] }
  departureList.set('scout', scoutId ? await $getOrFail(Parse.User, scoutId) : null)
  const scout = scoutId ? $parsify(Parse.User, scoutId) : null
  departureList.set({ scout })
  const audit = { user, fn: 'departure-list-update', data: { changes } }
  const notifyScout = !!departureList.get('status')
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScout } })
  return {
    data: departureList.get('scout'),
    message: `Abfahrtsliste gespeichert. ${notifyScout ? 'Scout notified.' : ''}`
  }
}, { requireUser: true })

Parse.Cloud.define('departure-list-update-quota', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  if (departureList.get('type') !== 'scout') {
    throw new Error('Nur für Scout-Listen')
  }
  const { quota } = normalizeFields({ ...params, type: departureList.get('type') })

  const changes = $changes(departureList, { quota })
  if (!changes.quota) {
    throw new Error('Keine Änderungen')
  }
  departureList.set({ quota })
  const audit = { user, fn: 'departure-list-update', data: { changes } }
  await departureList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: departureList.get('quota'),
    message: 'Anzahl gespeichert.'
  }
}, { requireUser: true })

Parse.Cloud.define('departure-list-update-due-date', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const { dueDate } = normalizeFields({ ...params, type: departureList.get('type') })

  const changes = $changes(departureList, { dueDate })
  if (!changes.dueDate) {
    throw new Error('Keine Änderungen')
  }
  departureList.set({ dueDate })
  const audit = { user, fn: 'departure-list-update', data: { changes } }
  await departureList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: departureList.get('dueDate'),
    message: 'Fälligkeitsdatum gespeichert.'
  }
}, { requireUser: true })

Parse.Cloud.define('departure-list-appoint', async ({ params: { id: departureListId }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  if (departureList.get('status')) {
    throw new Error('Only draft Abfahrtsliste can be appointed.')
  }
  if (!departureList.get('manager')) {
    throw new Error('Need a manager to appoint to')
  }
  departureList.set({ status: 'appointed' })
  const audit = { user, fn: 'departure-list-assign' }
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScout: true } })
  return {
    data: departureList.get('status'),
    message: 'Abfahrtslist ernennt. Manager notified.'
  }
}, { requireUser: true })

Parse.Cloud.define('departure-list-assign', async ({ params: { id: departureListId }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  if (!departureList.get('manager') || departureList.get('status') !== 'appointed') {
    throw new Error('Only Abfahrtsliste appointed to a manager be assigned.')
  }
  if (!departureList.get('scout')) {
    throw new Error('Need a scout to assign to')
  }
  departureList.set({ status: 'assigned' })
  const audit = { user, fn: 'departure-list-assign' }
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScout: true } })
  return { message: 'Abfahrtslist beauftragt. Scout notified.' }
}, { requireUser: true })

// Divides a departure list that has no ort
function validateDivide (departureList, user) {
  if (departureList.get('status') !== 'appointed') {
    throw new Error('Only departure lists that have been appointed, but not assigned can be divided')
  }
  if (departureList.get('ort')) {
    throw new Error('Only departure lists without ort can be divided')
  }
  if (departureList.get('manager').id !== user.id) {
    throw new Error('Only the departure lists manager can divide')
  }
}

async function getLocationsFromCubeIds (cubeIds) {
  const cubes = await $query('Cube')
    .containedIn('objectId', cubeIds)
    .limit(cubeIds.length)
    .select(['objectId', 'ort'])
    .find({ useMasterKey: true })
  const locations = {}
  for (const cube of cubes) {
    const ort = cube.get('ort')
    if (!locations[ort]) {
      locations[ort] = []
    }
    locations[ort].push(cube.id)
  }
  return locations
}

Parse.Cloud.define('departure-list-preview-divide', async ({ params: { id: departureListId }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  validateDivide(departureList, user)
  const locations = await getLocationsFromCubeIds(departureList.get('cubeIds') || [])
  return {
    parentId: departureListId,
    locations
  }
}, { requireUser: true })

Parse.Cloud.define('departure-list-divide', async ({ params: { id: departureListId }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  validateDivide(departureList, user)
  const locations = await getLocationsFromCubeIds(departureList.get('cubeIds') || [])
  for (const ort of Object.keys(locations)) {
    const newDepartureList = new DepartureList()
    newDepartureList.set({
      name: departureList.get('name') + ' ' + ort,
      type: departureList.get('type'),
      briefing: departureList.get('briefing'),
      disassembly: departureList.get('disassembly'),
      control: departureList.get('control'),
      quota: departureList.get('quota'),
      dueDate: departureList.get('dueDate'),
      scout: departureList.get('scout'),
      manager: departureList.get('manager'),
      state: departureList.get('state'),
      status: 'appointed',
      ort,
      cubeIds: locations[ort]
    })
    await newDepartureList.save(null, { useMasterKey: true, context: { audit: { user, fn: 'departure-list-divide' } } })
  }
  await departureList.destroy({ useMasterKey: true })
  return 'Abfahrtsliste unterteilt.'
}, { requireUser: true })

Parse.Cloud.define('departure-list-approve-verified-cube', async ({ params: { id: departureListId, cubeId, approved }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const cube = await $getOrFail('Cube', cubeId)
  if (!cube.get('vAt')) {
    throw new Error('Only verified cubes can be approved')
  }
  let adminApprovedCubeIds = departureList.get('adminApprovedCubeIds') || []
  adminApprovedCubeIds = approved
    ? [...adminApprovedCubeIds, cubeId]
    : adminApprovedCubeIds.filter(id => id !== cubeId)

  departureList.set('adminApprovedCubeIds', [...new Set(adminApprovedCubeIds)])
  const audit = { user, fn: 'scout-submission-preapprove', data: { cubeId, approved } }
  await departureList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return approved ? 'Verified cube marked as approved' : 'Cube unmarked as approved'
}, { requireUser: true })

Parse.Cloud.define('departure-list-remove', async ({ params: { id: departureListId } }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  if (!(!departureList.get('status') || departureList.get('status') === 'appointed')) {
    throw new Error('Only draft or appointed Abfahrtsliste can be removed.')
  }
  await departureList.destroy({ useMasterKey: true })
  return { message: 'Abfahrtsliste gelöscht.' }
}, { requireUser: true })

Parse.Cloud.define('scout-submission-submit', async ({ params: { id: departureListId, cubeId, submissionId, form, photoIds, comments }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const cube = await $getOrFail('Cube', cubeId)
  const submission = submissionId
    ? await $getOrFail(ScoutSubmission, submissionId)
    : new ScoutSubmission({ departureList, cube })
  submission.set({
    scout: user,
    status: null
  })

  let changes
  if (form.notFound) {
    for (const photo of submission.get('photos') || []) {
      await photo.destroy({ useMasterKey: true })
    }
    submission.set({ form }).unset('photos')
    if (submissionId) {
      changes.notFound = true
    }
  } else {
    delete form.notFound
    const photos = await $query('CubePhoto').containedIn('objectId', photoIds).find({ useMasterKey: true })
    if (submissionId) {
      changes = $changes(submission.get('form'), form, true)
    }
    submission.set({ form, photos })
  }

  await submission.save(null, { useMasterKey: true })
  if (comments) {
    await Parse.Cloud.run('comment-create', {
      itemClass: 'Cube',
      itemId: cubeId,
      source: 'ScoutSubmission:' + submission.id,
      text: comments
    }, { sessionToken: user.get('sessionToken') })
  }
  departureList.set({ status: 'in_progress' })
  const audit = { user, fn: 'scout-submission-submit', data: { cubeId, changes } }
  await departureList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  if (user.get('accType') === 'admin') {
    return Parse.Cloud.run('scout-submission-approve', { id: submission.id }, { sessionToken: user.get('sessionToken') })
  }
  return submission
}, { requireUser: true })

Parse.Cloud.define('scout-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $query(ScoutSubmission).include(['departureList', 'cube', 'photos']).get(submissionId, { useMasterKey: true })
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
    const { stateId, htId } = form
    cube.set('state', $parsify('State', stateId))
    cube.set('ht', $parsify('HousingType', htId))
    const { sides } = form
    cube.set({ sides, vAt: new Date() })
    await cube.save(null, { useMasterKey: true })
  }

  submission.set({ status: 'approved' })
  const audit = { user, fn: 'scout-submission-approve', data: { cubeId: cube.id } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return submission
}, { requireUser: true })

Parse.Cloud.define('scout-submission-reject', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(ScoutSubmission, submissionId)
  submission.set({ status: 'rejected' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'scout-submission-reject', data: { cubeId } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return submission
}, { requireUser: true })

Parse.Cloud.define('control-submission-submit', async ({ params: { id: departureListId, cubeId, submissionId, condition, beforePhotoId, afterPhotoId, comment }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const cube = await $getOrFail('Cube', cubeId)
  const submission = submissionId
    ? await $getOrFail(ControlSubmission, submissionId)
    : new ControlSubmission({ departureList, cube })
  if (condition !== 'no_ad') {
    comment = null
  }
  let changes
  if (submission.id) {
    changes = $changes(submission, { condition, comment })
  }
  submission.set({
    scout: user,
    status: null,
    condition,
    comment
  })
  submission.set('beforePhoto', beforePhotoId ? await $getOrFail('FileObject', beforePhotoId) : null)
  submission.set('afterPhoto', afterPhotoId ? await $getOrFail('FileObject', afterPhotoId) : null)
  await submission.save(null, { useMasterKey: true })
  departureList.set({ status: 'in_progress' })
  const audit = { user, fn: 'control-submission-submit', data: { cubeId, changes } }
  await departureList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return submission
}, { requireUser: true })

Parse.Cloud.define('control-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(ControlSubmission, submissionId, ['departureList'])
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'control-submission-approve', data: { cubeId } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return submission
}, { requireUser: true })

Parse.Cloud.define('control-submission-reject', async ({ params: { id: submissionId, rejectionReason }, user }) => {
  const submission = await $getOrFail(ControlSubmission, submissionId, ['departureList'])
  submission.set({ status: 'rejected', rejectionReason })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'control-submission-reject', data: { cubeId, rejectionReason } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  await $notify({
    user: submission.get('scout'),
    message: `Your submission for ${submission.get('cube').id} was rejected. ${rejectionReason}`,
    uri: `/departure-lists/${submission.get('departureList').id}/control/${submission.get('cube').id}`,
    data: { rejectionReason }
  })
  return submission
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-submit', async ({ params: { id: departureListId, cubeId, submissionId, condition, photoId }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const cube = await $getOrFail('Cube', cubeId)
  const submission = submissionId
    ? await $getOrFail(DisassemblySubmission, submissionId)
    : new DisassemblySubmission({ departureList, cube })
  let changes
  if (submission.id) {
    changes = $changes(submission, { condition })
  }
  submission.set({
    scout: user,
    condition,
    status: null,
    photo: photoId ? await $getOrFail('FileObject', photoId) : null
  })
  const audit = { user, fn: 'disassembly-submission-submit', data: { cubeId, changes } }
  await submission.save(null, { useMasterKey: true })
  departureList.set({ status: 'in_progress' })
  await departureList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return submission
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const submission = await $query(DisassemblySubmission).include(['departureList']).get(submissionId, { useMasterKey: true })
  submission.set({ status: 'approved' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'disassembly-submission-approve', data: { cubeId } }
  await submission.save(null, { useMasterKey: true })
  await submission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return submission
}, { requireUser: true })

Parse.Cloud.define('disassembly-submission-reject', async ({ params: { id: submissionId }, user }) => {
  const submission = await $getOrFail(DisassemblySubmission, submissionId)
  submission.set({ status: 'rejected' })
  const cubeId = submission.get('cube').id
  const audit = { user, fn: 'disassembly-submission-reject', data: { cubeId } }
  await submission.save(null, { useMasterKey: true, context: { audit } })
  await submission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return submission
}, { requireUser: true })

Parse.Cloud.define('departure-list-complete', async ({ params: { id: departureListId }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  if (departureList.get('status') !== 'in_progress') {
    throw new Error('Only in_progress Abfahrtsliste can be completed.')
  }
  departureList.set({ status: 'completed' })
  const audit = { user, fn: 'departure-list-complete' }
  return departureList.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })
