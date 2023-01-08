const { capitalize } = require('lodash')
const { departureLists: { normalizeFields } } = require('@/schema/normalizers')

const DepartureList = Parse.Object.extend('DepartureList')
const ScoutSubmission = Parse.Object.extend('ScoutSubmission')
const ControlSubmission = Parse.Object.extend('ControlSubmission')

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
      const placeKey = departureList.get('placeKey')
      if (placeKey) {
        const [ort, stateId] = placeKey.split('_')
        const state = await $getOrFail('State', stateId)
        name += `${ort} (${state.get('name')})`
      }
      departureList.set('name', name)
    }
  }

  const cubeIds = [...new Set(departureList.get('cubeIds') || [])]
  cubeIds.sort()
  departureList.set('cubeIds', cubeIds)
  departureList.set('cubeCount', cubeIds.length)

  const placeKey = departureList.get('placeKey')
  if (placeKey) {
    const [ort, state] = placeKey.split('_')
    departureList.set('cubesQuery', { ort, state })
  }

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
    message: `You have been appointed to scout ${departureList.get('name')}`,
    uri: `/departure-lists/${departureList.id}`,
    data: { departureListId: departureList.id }
  })
})

Parse.Cloud.beforeFind(DepartureList, async ({ query, user }) => {
  query._include.includes('all') && query.include(['briefing', 'control', 'submissions'])
  if (user?.get('accType') === 'distributor' && user.get('distributorRoles').includes('manage-scouts')) {
    const company = user.get('company')
    if (!company) {
      query.equalTo('scout', user)
      return
    }
    const scouts = await $query(Parse.User).equalTo('company', company).find({ useMasterKey: true })
    query.containedIn('scout', scouts)
    return
  }
  if (user?.get('accType') === 'scout') {
    query.equalTo('scout', user).notEqualTo('status', null)
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
      departureList.set('submissions', submissions)
    }
    if (departureList.get('placeKey')) {
      const [ort, stateId] = departureList.get('placeKey').split('_')
      ort && departureList.set({ ort })
      departureList.set('state', $parsify('State', stateId))
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

Parse.Cloud.define('departure-list-update-cubes', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  // TODO: check if user is allowed to update
  // TODO: check if departure list is not completed
  const { cubeIds } = normalizeFields(params)
  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(departureList, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  departureList.set({ cubeIds })
  const audit = { user, fn: 'departure-list-update', data: { cubeChanges } }
  return departureList.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('departure-list-update', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const {
    cubeIds,
    name,
    quota,
    dueDate,
    scoutId
  } = normalizeFields({ ...params, type: departureList.get('type') })

  // TODO: check if list can be updated still
  $cubeLimit(cubeIds.length)

  const cubeChanges = $cubeChanges(departureList, cubeIds)
  cubeChanges && departureList.set({ cubeIds })

  const changes = $changes(departureList, { name, quota, dueDate })
  departureList.set({
    cubeIds,
    name,
    quota,
    dueDate
  })

  if (scoutId !== departureList.get('scout')?.id) {
    changes.scoutId = [departureList.get('scout')?.id, scoutId]
    departureList.set('scout', scoutId ? await $getOrFail(Parse.User, scoutId) : null)
  }

  const audit = { user, fn: 'departure-list-update', data: { changes, cubeChanges } }
  const notifyScout = Boolean(departureList.get('status') && scoutId && changes.scoutId)
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScout } })
  return `Abfahrtsliste gespeichert. ${notifyScout ? 'Scout notified.' : ''}`
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
  return departureList.save(null, { useMasterKey: true, context: { audit } })
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
  return `Abfahrtsliste gespeichert. ${notifyScout ? 'Scout notified.' : ''}`
}, { requireUser: true })

Parse.Cloud.define('departure-list-appoint', async ({ params: { id: departureListId }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  if (departureList.get('status')) {
    throw new Error('Only draft Abfahrtsliste can be appointed.')
  }
  if (!departureList.get('scout')) {
    throw new Error('Need a scout to appoint to')
  }
  departureList.set({ status: 'appointed' })
  const audit = { user, fn: 'departure-list-appoint' }
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScout: true } })
  return 'Abfahrtslist beauftragt. Scout notified.'
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
  return departureList.destroy({ useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('scout-submission-submit', async ({ params: { id: departureListId, cubeId, submissionId, form, photoIds, comments }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const cube = await $getOrFail('Cube', cubeId)
  const scoutSubmission = submissionId
    ? await $getOrFail(ScoutSubmission, submissionId)
    : new ScoutSubmission({ departureList, cube })
  scoutSubmission.set({
    scout: user,
    status: null,
    scoutedAt: new Date()
  })

  let changes
  if (form.notFound) {
    for (const photo of scoutSubmission.get('photos') || []) {
      await photo.destroy({ useMasterKey: true })
    }
    scoutSubmission.set({ form }).unset('photos')
    if (submissionId) {
      changes.notFound = true
    }
  } else {
    delete form.notFound
    const photos = await $query('CubePhoto').containedIn('objectId', photoIds).find({ useMasterKey: true })
    if (submissionId) {
      changes = $changes(scoutSubmission.get('form'), form, true)
    }
    scoutSubmission.set({ form, photos })
  }

  const { id } = await scoutSubmission.save(null, { useMasterKey: true })
  if (comments) {
    await Parse.Cloud.run('comment-create', {
      itemClass: 'Cube',
      itemId: cubeId,
      source: 'ScoutSubmission:' + id,
      text: comments
    }, { sessionToken: user.get('sessionToken') })
  }
  departureList.set({ status: 'in_progress' })
  const audit = { user, fn: 'scout-submission-submit', data: { cubeId, changes } }
  await departureList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  if (user.get('accType') === 'admin') {
    return Parse.Cloud.run('scout-submission-approve', { id: scoutSubmission.id }, { sessionToken: user.get('sessionToken') })
  }
  return scoutSubmission
}, { requireUser: true })

Parse.Cloud.define('scout-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const scoutSubmission = await $query(ScoutSubmission).include(['departureList', 'cube', 'photos']).get(submissionId, { useMasterKey: true })
  const cube = scoutSubmission.get('cube')

  // if not found, soft delete the cube
  if (scoutSubmission.get('form').notFound) {
    cube.set('dAt', new Date())
    await cube.save(null, { useMasterKey: true })
  } else {
    // save details to cube and approve photos
    const photos = scoutSubmission.get('photos')
    await Parse.Object.saveAll(photos.map(photo => photo.set('approved', true)), { useMasterKey: true })
    const form = scoutSubmission.get('form')
    const { str, hsnr, ort, plz } = form.address
    cube.set({ str, hsnr, ort, plz })
    const { stateId, htId } = form
    cube.set('state', $parsify('State', stateId))
    cube.set('ht', $parsify('HousingType', htId))
    const { sides } = form
    cube.set({ sides, vAt: new Date() })
    await cube.save(null, { useMasterKey: true })
  }

  scoutSubmission.set({ status: 'approved' })
  const audit = { user, fn: 'scout-submission-approve', data: { cubeId: cube.id } }
  await scoutSubmission.save(null, { useMasterKey: true })
  await scoutSubmission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return scoutSubmission
}, { requireUser: true })

Parse.Cloud.define('scout-submission-reject', async ({ params: { id: submissionId }, user }) => {
  const scoutSubmission = await $getOrFail(ScoutSubmission, submissionId)
  scoutSubmission.set({ status: 'rejected' })
  const cubeId = scoutSubmission.get('cube').id
  const audit = { user, fn: 'scout-submission-reject', data: { cubeId } }
  await scoutSubmission.save(null, { useMasterKey: true, context: { audit } })
  await scoutSubmission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return scoutSubmission
}, { requireUser: true })

Parse.Cloud.define('control-submission-submit', async ({ params: { id: departureListId, cubeId, submissionId, condition, beforePhotoId, afterPhotoId, comments }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const cube = await $getOrFail('Cube', cubeId)
  const controlSubmission = submissionId
    ? await $getOrFail(ControlSubmission, submissionId)
    : new ControlSubmission({ departureList, cube })
  controlSubmission.set({
    scout: user,
    condition,
    status: null,
    controlledAt: new Date()
  })
  controlSubmission.set('beforePhoto', beforePhotoId ? await $getOrFail('FileObject', beforePhotoId) : null)
  controlSubmission.set('afterPhoto', afterPhotoId ? await $getOrFail('FileObject', afterPhotoId) : null)
  const { id } = await controlSubmission.save(null, { useMasterKey: true })
  if (comments) {
    await Parse.Cloud.run('comment-create', {
      itemClass: 'Cube',
      itemId: cubeId,
      source: 'ControlSubmission:' + id,
      text: comments
    }, { sessionToken: user.get('sessionToken') })
  }
  departureList.set({ status: 'in_progress' })
  const audit = { user, fn: 'control-submission-submit', data: { cubeId } }
  await departureList.save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return controlSubmission
}, { requireUser: true })

Parse.Cloud.define('control-submission-approve', async ({ params: { id: submissionId }, user }) => {
  const controlSubmission = await $query(ControlSubmission).include(['departureList', 'cube', 'photos']).get(submissionId, { useMasterKey: true })
  controlSubmission.set({ status: 'approved' })
  const cubeId = controlSubmission.get('cube').id
  const audit = { user, fn: 'control-submission-approve', data: { cubeId } }
  await controlSubmission.save(null, { useMasterKey: true })
  await controlSubmission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return controlSubmission
}, { requireUser: true })

Parse.Cloud.define('control-submission-reject', async ({ params: { id: submissionId }, user }) => {
  const controlSubmission = await $getOrFail(ControlSubmission, submissionId)
  controlSubmission.set({ status: 'rejected' })
  const cubeId = controlSubmission.get('cube').id
  const audit = { user, fn: 'control-submission-reject', data: { cubeId } }
  await controlSubmission.save(null, { useMasterKey: true, context: { audit } })
  await controlSubmission.get('departureList').save(null, { useMasterKey: true, context: { countCubes: true, audit } })
  return controlSubmission
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
