const { capitalize } = require('lodash')
const { departureLists: { normalizeFields } } = require('@/schema/normalizers')

const DepartureList = Parse.Object.extend('DepartureList')
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

Parse.Cloud.beforeSave(DepartureList, async ({ object: departureList, context: { countCubes } }) => {
  !departureList.get('status') && departureList.set('status', 0)
  // if (departureList.isNew()) {
  //   if (!departureList.get('name')) {
  //     departureList.set('name', `${departureList.get('ort')} (${departureList.get('state').id})`)
  //   }
  // }

  const cubeIds = [...new Set(departureList.get('cubeIds') || [])]
  cubeIds.sort()
  departureList.set('cubeIds', cubeIds)
  departureList.set('cubeCount', cubeIds.length)
  departureList.set('gp', await getCenterOfCubes(cubeIds))

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

async function setCubeTaskStatus (departureList) {
  const {
    id: listId,
    attributes: {
      cubeIds,
      type,
      dueDate,
      status,
      manager,
      scouts
    }
  } = departureList
  const task = {
    listId,
    type,
    status,
    dueDate,
    managerId: manager?.id,
    scoutIds: scouts.map(s => s.id)
  }
  if (status < 2) {
    // remove all cubes associated with list if not assigned to scout
    await $query('Cube')
      .equalTo('task.type', task.type)
      .equalTo('task.listId', task.listId)
      .each(cube => {
        cube.unset('task')
        return cube.save(null, { useMasterKey: true })
      }, { useMasterKey: true })
  } else {
    // remove all cubes that reference the list despite the list having them removed
    await $query('Cube')
      .notContainedIn('objectId', cubeIds)
      .equalTo('task.type', task.type)
      .equalTo('task.listId', task.listId)
      .each(cube => {
        cube.unset('task')
        return cube.save(null, { useMasterKey: true })
      }, { useMasterKey: true })
  }
  return $query('Cube').containedIn('objectId', cubeIds || []).each(cube => cube.set('task', task).save(null, { useMasterKey: true }), { useMasterKey: true })
}

Parse.Cloud.afterSave(DepartureList, async ({ object: departureList, context: { audit, setCubeStatuses, notifyScouts } }) => {
  setCubeStatuses && await setCubeTaskStatus(departureList)
  $audit(departureList, audit)
  notifyScouts && consola.warn('Todo: Notify together')
  // notifyScouts && $notify({
  //   user: departureList.get('scouts'),
  //   message: `You have been assigned to scout ${departureList.get('ort')}`,
  //   uri: `/departure-lists/${departureList.id}`,
  //   data: { departureListId: departureList.id }
  // })
})

Parse.Cloud.beforeFind(DepartureList, async ({ query, user, master }) => {
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

Parse.Cloud.afterFind(DepartureList, async ({ objects: departureLists, query }) => {
  for (const departureList of departureLists) {
    if (departureList.get('type') === 'scout' && !departureList.get('dueDate')) {
      departureList.set('dueDate', departureList.get('briefing').get('dueDate'))
    }
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
    if (query._include.includes('cubeLocations')) {
      const cubeIds = departureList.get('cubeIds') || []
      const cubeLocations = await $query('Cube')
        .containedIn('objectId', cubeIds)
        .select('gp')
        .limit(cubeIds.length)
        .find({ useMasterKey: true })
        .then((cubes) => cubes.reduce((acc, cube) => {
          acc[cube.id] = cube.get('gp')
          return acc
        }, {}))
      departureList.set({ cubeLocations })
    }
  }
  return departureLists
})

Parse.Cloud.afterDelete(DepartureList, $deleteAudits)

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

Parse.Cloud.define('departure-list-update-scouts', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  const { scoutIds } = normalizeFields(params)
  const currentScoutIds = (departureList.get('scouts') || []).map(s => s.id)
  if (scoutIds === currentScoutIds) {
    throw new Error('Keine Änderungen')
  }
  const changes = { scoutIds: [currentScoutIds, scoutIds] }
  departureList.set('scouts', scoutIds ? scoutIds.map(id => $parsify(Parse.User, id)) : null)
  const audit = { user, fn: 'departure-list-update', data: { changes } }
  // TODO: Notify when changing scout
  let notifyScouts
  // const notifyScouts = !!departureList.get('status')
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScouts } })
  return {
    data: departureList.get('scouts'),
    message: `Abfahrtsliste gespeichert. ${notifyScouts ? 'Scouts notified.' : ''}`
  }
}, { requireUser: true })

Parse.Cloud.define('departure-list-update-quotas', async ({ params: { id: departureListId, ...params }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  if (departureList.get('type') !== 'scout') {
    throw new Error('Nur für Scout-Listen')
  }
  const { quotas } = normalizeFields({ ...params, type: departureList.get('type') })

  const changes = $changes(departureList, { quotas })
  if (!changes.quotas) {
    throw new Error('Keine Änderungen')
  }
  departureList.set({ quotas })
  const audit = { user, fn: 'departure-list-update', data: { changes } }
  await departureList.save(null, { useMasterKey: true, context: { audit } })
  return {
    data: departureList.get('quotas'),
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
  if (!departureList.get('date') || !departureList.get('dueDate')) {
    throw new Error('Please set date and due date first.')
  }
  departureList.set({ status: 1 })
  const audit = { user, fn: 'departure-list-appoint' }
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScout: true, setCubeStatuses: true } })
  return {
    data: departureList.get('status'),
    message: 'Abfahrtslist ernennt. Manager notified.'
  }
}, { requireUser: true })

Parse.Cloud.define('departure-list-assign', async ({ params: { id: departureListId }, user }) => {
  const departureList = await $getOrFail(DepartureList, departureListId)
  if (!departureList.get('manager') || departureList.get('status') !== 1) {
    consola.info(departureList.attributes)
    throw new Error('Only Abfahrtsliste appointed to a manager be assigned.')
  }
  if (!(departureList.get('scouts') || []).length) {
    throw new Error('Need a scout to assign to')
  }
  if (!departureList.get('date') || !departureList.get('dueDate')) {
    throw new Error('Please set date and due date first.')
  }
  if (moment(departureList.get('date')).isAfter(await $today(), 'day')) {
    throw new Error(`You can assign this task only from ${moment(departureList.get('date')).format('DD.MM.YYYY')}`)
  }
  departureList.set({ status: 2 })
  const audit = { user, fn: 'departure-list-assign' }
  await departureList.save(null, { useMasterKey: true, context: { audit, notifyScout: true, setCubeStatuses: true } })
  return {
    data: departureList.get('status'),
    message: 'Abfahrtslist beauftragt. Scout notified.'
  }
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

// TODO: Removals
// Parse.Cloud.define('departure-list-remove', async ({ params: { id: departureListId } }) => {
//   const departureList = await $getOrFail(DepartureList, departureListId)
//   if (!(!departureList.get('status') || departureList.get('status') === 'appointed')) {
//     throw new Error('Only draft or appointed Abfahrtsliste can be removed.')
//   }
//   await departureList.destroy({ useMasterKey: true })
//   return { message: 'Abfahrtsliste gelöscht.' }
// }, { requireUser: true })

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
  departureList.set({ status: 3 })
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
  departureList.set({ status: 3 })
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
  departureList.set({ status: 3 })
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
  if (departureList.get('status') !== 3) {
    throw new Error('Only in_progress Abfahrtsliste can be completed.')
  }
  departureList.set({ status: 4 })
  const audit = { user, fn: 'departure-list-complete' }
  return departureList.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })
