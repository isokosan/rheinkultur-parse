const { v4: uuidv4 } = require('uuid')
const { sum } = require('lodash')
const redis = require('@/services/redis')
const { ensureUniqueField } = require('@/utils')
const {
  countCubes,
  indexFrameMountRequests,
  unindexFrameMountRequests,
  indexFrameMountTakedowns,
  unindexFrameMountTakedowns
} = require('@/cloud/search')

const {
  normalizeCubeIds,
  frameMounts: { UNSET_NULL_FIELDS, normalizeFields }
} = require('@/schema/normalizers')
const {
  validateOrderFinalize,
  setOrderCubeStatuses,
  getLastRemovedCubeIds,
  earlyCancelSpecialFormats
} = require('@/shared')

const FrameMount = Parse.Object.extend('FrameMount')

Parse.Cloud.beforeSave(FrameMount, async ({ object: frameMount, context: { setCubeStatuses } }) => {
  frameMount.isNew() && await ensureUniqueField(frameMount, 'pk', 'company')
  UNSET_NULL_FIELDS.forEach(field => !frameMount.get(field) && frameMount.unset(field))
  const fmCounts = frameMount.get('fmCounts') || {}
  if (Object.values(fmCounts).some(qty => qty <= 0)) {
    throw new Error('fmCounts must be positive')
  }
  !frameMount.get('takedowns') && frameMount.set('takedowns', {})
  const cubeIds = frameMount.get('cubeIds') || []
  cubeIds.sort()
  frameMount.set('cubeIds', cubeIds)
  frameMount.set('freedCount', frameMount.get('status') > 2.1 ? cubeIds.length : 0)

  if (setCubeStatuses) {
    const earlyCancellations = {}
    const takedowns = frameMount.get('takedowns') || {}
    const tdCounts = {
      accepted: 0,
      pending: 0,
      quota: 0
    }
    for (const cubeId of Object.keys(takedowns)) {
      const takedown = takedowns[cubeId]
      if (takedown.date) {
        earlyCancellations[cubeId] = takedown.date
        tdCounts.accepted += takedown.qty
      } else {
        tdCounts.pending += fmCounts[cubeId] || 0
      }
    }
    // remove early canceled from fmCounts
    for (const cubeId of Object.keys(earlyCancellations)) {
      delete fmCounts[cubeId]
    }
    // get all audits where there are changes in fmCounts
    const cubeHistory = {}
    const requestHistory = frameMount.get('requestHistory') || []
    for (const request of requestHistory) {
      const date = request.date
      for (const cubeId of frameMount.get('cubeIds') || []) {
        const before = request.changes.fmCounts[0]?.[cubeId] || 0
        const after = request.changes.fmCounts[1]?.[cubeId] || 0
        if (before !== after) {
          cubeHistory[cubeId] = cubeHistory[cubeId] || []
          cubeHistory[cubeId].push({ date, qty: after })
        }
      }
    }
    for (const cubeId of Object.keys(earlyCancellations)) {
      cubeHistory[cubeId] = cubeHistory[cubeId] || []
      const date = earlyCancellations[cubeId]
      if (!cubeHistory[cubeId].find((change) => change.date === date && change.qty === 0)) {
        cubeHistory[cubeId].push({ date, qty: 0 })
      }
    }
    // we can use cubeHistory later for another purpose but for now we will convert these to startsAt and endsAt dates
    const fmDates = {}
    for (const cubeId of Object.keys(cubeHistory)) {
      cubeHistory[cubeId].sort((a, b) => a.date - b.date)
      const startsAt = cubeHistory[cubeId].find((change) => change.qty > 0)?.date
      fmDates[cubeId] = { startsAt }
      const endsAt = cubeHistory[cubeId].find((change) => change.qty === 0)?.date
      if (endsAt) {
        fmDates[cubeId].endsAt = endsAt
      }
    }
    const fmCount = sum(Object.values(fmCounts))
    tdCounts.quota = parseInt((fmCount + tdCounts.accepted) * 0.1)
    frameMount
      .set('earlyCancellations', earlyCancellations)
      .set('cubeHistory', cubeHistory)
      .set('fmDates', fmDates)
      .set('cubeCount', Object.keys(fmCounts).length)
      .set('fmCounts', fmCounts)
      .set('fmCount', fmCount)
      .set('tdCounts', tdCounts)
  }
})

Parse.Cloud.afterSave(FrameMount, async ({ object: frameMount, context: { audit, setCubeStatuses } }) => {
  if (setCubeStatuses) {
    await frameMount.fetch({ useMasterKey: true })
    await setOrderCubeStatuses(frameMount)
    await earlyCancelSpecialFormats(frameMount)
  }
  await indexFrameMountRequests(frameMount)
  await indexFrameMountTakedowns(frameMount)
  audit && $audit(frameMount, audit)
})

async function getOrCacheScoutingSummaries (frameMounts) {
  const company = frameMounts[0].get('company')
  const keys = frameMounts.map(fm => `frame-mount-scouting-${fm.get('pk')}`)
  const cached = await redis.mget(...keys)
  const missing = []
  const summaries = []
  for (let i = 0; i < frameMounts.length; i++) {
    if (cached[i]) {
      summaries.push(JSON.parse(cached[i]))
    } else {
      missing.push(frameMounts[i])
    }
  }
  const scoutLocations = missing.map(fm => fm.get('pk'))
  const scoutLists = await $query('TaskList')
    .equalTo('type', 'scout')
    .matchesQuery('briefing', $query('Briefing').equalTo('company', company))
    .containedIn('pk', scoutLocations)
    .limit(scoutLocations.length * 2)
    .find({ useMasterKey: true })
  for (const frameMount of missing) {
    const taskLists = scoutLists
      .filter((list) => list.get('pk') === frameMount.get('pk'))
    const counts = taskLists
      .reduce((acc, list) => {
        const counts = list.get('counts') || {}
        for (const key of Object.keys(counts)) {
          acc[key] = (acc[key] || 0) + counts[key]
        }
        return acc
      }, {})
    counts.taskListIds = taskLists.map(list => list.id)
    if (!counts.total) {
      const [stateId, ort] = frameMount.get('pk').split(':')
      counts.total = await countCubes({
        filter: [
          { term: { 'ort.keyword': ort } },
          { term: { 'state.objectId.keyword': stateId } }
        ],
        must: [
          { range: { s: { lt: 5 } } }
        ]
      })
    }
    if (counts.total) {
      counts.cubes = counts.total
      counts.progress = parseInt((counts.completed / counts.total) * 100)
    }
    await redis.set(`frame-mount-scouting-${frameMount.get('pk')}`, JSON.stringify(counts))
    await redis.expire(`frame-mount-scouting-${frameMount.get('pk')}`, 60 * 5) // 5 minutes
    summaries.push(counts)
  }
  return summaries.reduce((acc, summary, i) => {
    acc[frameMounts[i].id] = summary
    return acc
  }, {})
}

Parse.Cloud.beforeFind(FrameMount, ({ query }) => {
  query._include.includes('all') && query.include([
    'company',
    'scouting',
    'docs',
    'tags',
    'lastRemovedCubeIds'
  ])
})

Parse.Cloud.afterFind(FrameMount, async ({ query, objects: frameMounts }) => {
  if (!frameMounts.length) { return }
  const cities = await $query('City').containedIn('objectId', frameMounts.map(fm => fm.get('pk'))).find({ useMasterKey: true })
  const includeScouting = query._include.includes('scouting')
  const scoutingSummaries = includeScouting ? await getOrCacheScoutingSummaries(frameMounts) : {}
  for (const frameMount of frameMounts) {
    frameMount.set('city', cities.find((c) => c.id === frameMount.get('pk')))
    frameMount.set('scouting', scoutingSummaries[frameMount.id])
    if (query._include.includes('lastRemovedCubeIds') && frameMount.get('status') >= 0 && frameMount.get('status') <= 2.1) {
      frameMount.set('lastRemovedCubeIds', await getLastRemovedCubeIds('FrameMount', frameMount.id))
    }
  }
})

Parse.Cloud.beforeDelete(FrameMount, async ({ object: frameMount }) => {
  if (frameMount.get('status') !== 0 && frameMount.get('status') !== 2) {
    throw new Error('Nur Aufträge im Entwurfsstatus können gelöscht werden!')
  }
  await unindexFrameMountRequests(frameMount)
  await unindexFrameMountTakedowns(frameMount)
})
Parse.Cloud.afterDelete(FrameMount, async ({ object: frameMount }) => {
  $deleteAudits({ object: frameMount })
})

Parse.Cloud.define('frame-mount-create', async ({ params, user, master }) => {
  const {
    companyId,
    companyPersonId,
    pk,
    planned,
    reservedUntil
  } = normalizeFields(params)
  const company = await $getOrFail('Company', companyId)
  const frameMount = new FrameMount({
    status: 0,
    company,
    companyPerson: companyPersonId ? await $getOrFail('Person', companyPersonId) : undefined,
    pk,
    planned,
    reservedUntil,
    responsibles: user ? [$pointer(Parse.User, user.id)] : undefined
  })
  const audit = { user, fn: 'frame-mount-create' }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-update-cubes', async ({ params: { id: frameMountId, ...params }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId, 'company')
  if (frameMount.get('status') >= 3) {
    throw new Error('Moskitorahmen ort ist abgeschlossen')
  }

  const cubeIds = normalizeCubeIds(params.cubeIds)
  const cubeChanges = $cubeChanges(frameMount, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  // if any removeCubeIds is mounted or has takedown error
  const fmCounts = frameMount.get('fmCounts') || {}
  const takedowns = frameMount.get('takedowns') || {}
  if (cubeChanges?.removed?.length && cubeChanges.removed.some(cubeId => fmCounts[cubeId] || takedowns[cubeId])) {
    throw new Error('Frame Mount has cube that cannot be removed')
  }
  frameMount.set({ cubeIds })
  const audit = { user, fn: 'frame-mount-update', data: { cubeChanges } }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-rate-selection', async ({ params: { id: frameMountId, cubeId, selectionRating }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  if (frameMount.get('status') >= 3) {
    throw new Error('Selektionen von finalisierte Moskitorahmen können nicht mehr geändert werden.')
  }
  const selectionRatings = await frameMount.get('selectionRatings') || {}
  if (selectionRatings[cubeId] === selectionRating) {
    throw new Error('Selektion bereits gesetzt.')
  }
  if (selectionRating === '⚪') {
    delete selectionRatings[cubeId]
  } else {
    selectionRatings[cubeId] = selectionRating
  }
  frameMount.set({ selectionRatings })
  return frameMount.save(null, { useMasterKey: true })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-update', async ({ params: { id: frameMountId, ...params }, user }) => {
  const {
    cubeIds,
    planned,
    reservedUntil
  } = normalizeFields(params)

  const frameMount = await $getOrFail(FrameMount, frameMountId, ['all'])
  if (frameMount.get('status') >= 3) {
    throw new Error('Finalisierte Aufträge können nicht mehr geändert werden.')
  }

  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(frameMount, cubeIds)
  // if any removeCubeIds is mounted or has takedown error
  const fmCounts = frameMount.get('fmCounts') || {}
  const takedowns = frameMount.get('takedowns') || {}
  if (cubeChanges?.removed?.length && cubeChanges.removed.some(cubeId => fmCounts[cubeId] || takedowns[cubeId])) {
    throw new Error('Frame Mount has cube that cannot be removed')
  }
  cubeChanges && frameMount.set({ cubeIds })

  const changes = $changes(frameMount, {
    planned,
    reservedUntil
  })
  frameMount.set({
    planned,
    reservedUntil
  })

  frameMount.get('status') === 1 && frameMount.set('status', 0)
  const audit = { user, fn: 'frame-mount-update', data: { changes, cubeChanges } }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-finalize', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  await validateOrderFinalize(frameMount)
  frameMount.set({ status: 3 })
  const audit = { user, fn: 'frame-mount-finalize' }

  // cleanup stars
  frameMount.set('stars', $cleanDict(frameMount.get('stars'), frameMount.get('cubeIds')))

  await frameMount.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Moskitorahmen finalisiert.'
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-undo-finalize', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  frameMount.set({ status: 2.1 })
  const audit = { user, fn: 'frame-mount-undo-finalize' }
  await frameMount.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Finalisierung zurückgezogen.'
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-remove', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  if (frameMount.get('status') !== 0 && frameMount.get('status') !== 2) {
    throw new Error('Nur Entwürfe können gelöscht werden.')
  }
  return frameMount.destroy({ useMasterKey: true })
}, $internOrAdmin)

// frame mount scouting rejections
Parse.Cloud.define('frames-rejections', async ({ params: { taskListIds }, user }) => {
  const isFramesManager = user.get('permissions').includes('manage-frames')
  if (!isFramesManager) {
    throw new Parse.Error(401, 'Unauthorized')
  }
  const taskListsQuery = await $query('TaskList').containedIn('objectId', taskListIds)
  return $query('ScoutSubmission')
    .matchesQuery('taskList', taskListsQuery)
    .equalTo('status', 'rejected')
    .include(['cube', 'photos'])
    .limit(1000)
    .find({ useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('frame-mount-request-draft', async ({ params: { id: frameMountId, fmCounts }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  if (frameMount.status < 3) { throw new Error('Frame location is not active') }
  const cubeIds = frameMount.get('cubeIds') || []
  const request = frameMount.get('request') || { id: uuidv4(), status: 'draft', createdAt: new Date() }
  if (request.status !== 'draft') {
    throw new Error('Nur Entwurfsanfragen können geändert werden.')
  }
  // if there is a frame request for a cubeId not freed then error
  if (Object.keys(fmCounts).some(cubeId => !cubeIds.includes(cubeId))) {
    throw new Error('Frame Mount has cube that is not in cubeIds')
  }
  fmCounts = $cleanDict(fmCounts, cubeIds, { filterZeros: true })
  const changes = $changes(frameMount, { fmCounts })
  // error if no changes
  if (!Object.keys(changes).length) {
    throw new Error('No changes')
  }
  request.updatedAt = new Date()
  request.changes = changes
  frameMount.set({ request })
  const audit = { user, fn: 'frame-mount-request-draft' }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $isFramePartner)

function calculateAddedRemovedFmCounts ([before, after]) {
  // number of added and removed frames
  let added = 0
  let removed = 0
  for (const key in after) {
    const bCount = before?.[key] || 0
    const aCount = after?.[key] || 0
    if (aCount > bCount) {
      added += aCount - bCount
    } else if (aCount < bCount) {
      removed += bCount - aCount
    }
  }
  for (const key in before) {
    if (!after[key]) {
      removed += before[key]
    }
  }
  return { added, removed }
}
Parse.Cloud.define('frame-mount-request-submit', async ({ params: { id: frameMountId, date, comments }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const request = frameMount.get('request')
  if (request.status !== 'draft') {
    throw new Error('Nur Entwurfsanfragen können abgesendet werden.')
  }
  const { added, removed } = calculateAddedRemovedFmCounts(request.changes.fmCounts)
  request.changes.added = added
  request.changes.removed = removed
  request.status = 'pending'
  request.comments = comments
  request.date = date
  request.user = user?.toPointer()
  request.updatedAt = new Date()
  frameMount.set({ request })
  const audit = { user, fn: 'frame-mount-request-submit' }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $isFramePartner)

Parse.Cloud.define('frame-mount-request-revert', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const request = frameMount.get('request')
  if (!['pending', 'rejected'].includes(request.status)) {
    throw new Error('Nur ausstehende Anfragen können zurückgezogen werden')
  }

  // remove all rejections
  for (const cubeId of Object.keys(request.rejections || {})) {
    request.changes.fmCounts[1][cubeId] = request.changes.fmCounts[0][cubeId]
  }
  delete request.rejections
  const { added, removed } = calculateAddedRemovedFmCounts(request.changes.fmCounts)
  request.changes.added = added
  request.changes.removed = removed
  delete request.rejectedAdded
  delete request.rejectedRemoved
  request.status = 'draft'
  request.updatedAt = new Date()
  frameMount.set({ request })
  const audit = { user, fn: 'frame-mount-request-revert' }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $isFramePartner)

Parse.Cloud.define('frame-mount-request-remove', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const request = frameMount.get('request')
  if (!['pending', 'draft'].includes(request.status)) {
    throw new Error('Nur Entwürfe oder ausstehende Anfragen können entfernt werden.')
  }
  frameMount.unset('request')
  const audit = { user, fn: 'frame-mount-remove-draft' }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $isFramePartner)

Parse.Cloud.define('frame-mount-request-reject', async ({ params: { id: frameMountId, comments }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const request = frameMount.get('request')
  if (!request) { throw new Error('Anfrage nicht gefunden.') }
  if (['accepted', 'rejected'].includes(request.status)) { throw new Error('Diese Anfrage wurde bereits akzeptiert oder abgelehnt.') }
  request.status = 'rejected'
  request.rejectionReason = comments?.trim()
  request.rejectedBy = user?.toPointer()
  request.rejectedAt = new Date()
  request.updatedAt = new Date()
  const requestHistory = frameMount.get('requestHistory') || []
  requestHistory.push(request)
  frameMount.set({ requestHistory }).unset('request')
  await frameMount.save(null, { useMasterKey: true })
  request.user && await $notify({
    user: request.user,
    identifier: 'frame-mount-request-rejected',
    data: { frameMountId, requestId: request.id, pk: frameMount.get('pk'), reason: request.rejectionReason }
  })
  return 'Anfrage abgelehnt.'
}, $internFrameManager)

Parse.Cloud.define('frame-mount-request-toggle-cube-rejection', async ({ params: { id: frameMountId, cubeId } }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const request = frameMount.get('request')
  if (!request) { throw new Error('Anfrage nicht gefunden.') }
  if (['accepted', 'rejected'].includes(request.status)) { throw new Error('Diese Anfrage wurde bereits akzeptiert oder abgelehnt.') }
  const { fmCounts } = request.changes
  if (!fmCounts[0]?.[cubeId] && !fmCounts[1]?.[cubeId]) {
    throw new Error('Cube nicht in Anfrage')
  }
  const rejections = request.rejections || {}
  rejections[cubeId] = rejections[cubeId] ? undefined : (fmCounts[1][cubeId] || 0) - (fmCounts[0][cubeId] || 0)
  request.rejections = $cleanDict(rejections, frameMount.get('cubeIds'))
  request.changes.rejectedAdded = Object.values(rejections).filter(qty => qty > 0).reduce((a, b) => a + b, 0)
  request.changes.rejectedRemoved = Object.values(rejections).filter(qty => qty < 0).reduce((a, b) => a + b, 0)
  if (((request.changes.rejectedAdded || 0) === (request.changes.added || 0)) && (((request.changes.rejectedRemoved || 0) * -1) === (request.changes.removed || 0))) {
    throw new Error('Sie können anstatt den gesamte Anfrage ablehnen')
  }
  frameMount.set({ request })
  await frameMount.save(null, { useMasterKey: true })
  return request
}, $internFrameManager)

Parse.Cloud.define('frame-mount-request-accept', async ({ params: { id: frameMountId, comments }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const request = frameMount.get('request')
  if (!request) { throw new Error('Anfrage nicht gefunden.') }
  if (['accepted', 'rejected'].includes(request.status)) { throw new Error('Diese Anfrage wurde bereits akzeptiert oder abgelehnt.') }
  request.status = 'accepted'
  request.acceptedBy = user?.toPointer()
  request.acceptedAt = new Date()
  request.updatedAt = new Date()
  request.acceptComments = comments?.trim()

  const requestHistory = frameMount.get('requestHistory') || []
  requestHistory.push(request)

  const { changes, rejections } = request
  const rejectedCubeIds = Object.keys(rejections || {})
  for (const cubeId of rejectedCubeIds) {
    changes.fmCounts[1][cubeId] = changes.fmCounts[0][cubeId]
  }
  const rejectionCount = rejectedCubeIds.length
  if (rejectionCount && !comments) {
    throw new Error('Bitte geben Sie einen Grund für die Einzelablehnungen an.')
  }
  frameMount
    .set({ requestHistory, fmCounts: changes.fmCounts[1] })
    .unset('request')
  const audit = { user, fn: 'frame-mount-request-accept', data: { changes } }
  await frameMount.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  request.acceptComments && request.user && await $notify({
    user: request.user,
    identifier: 'frame-mount-request-accept-comments',
    data: { frameMountId, requestId: request.id, pk: frameMount.get('pk'), rejectionCount, comments: request.acceptComments }
  })
}, $internFrameManager)

// TOCHECK: maybe better to use earlyCancelations here in order to keep historical data?
Parse.Cloud.define('frame-mount-remove-free', async ({ params: { id: frameMountId, cubeIds: removeCubeIds }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const fmCounts = frameMount.get('fmCounts') || {}
  const takedowns = frameMount.get('takedowns') || {}
  if (removeCubeIds === undefined) {
    removeCubeIds = frameMount.get('cubeIds').filter(cubeId => !fmCounts[cubeId] && !takedowns[cubeId])
  }
  // if any removeCubeIds is mounted or has takedown error
  if (removeCubeIds.some(cubeId => fmCounts[cubeId] || takedowns[cubeId])) {
    throw new Error('Frame Mount has cube that cannot be removed')
  }
  const cubeIds = frameMount.get('cubeIds').filter(cubeId => !removeCubeIds.includes(cubeId))
  const cubeChanges = $cubeChanges(frameMount, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  const audit = { user, fn: 'frame-mount-update', data: { cubeChanges } }
  return frameMount.set({ cubeIds }).save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, $internFrameManager)

// Takedown requests are in the form of cubeId => date
Parse.Cloud.define('frame-mount-takedown-request', async ({ params: { id: frameMountId, takedowns: form }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)

  // if there is a draft or waiting request on the cube error out
  const request = frameMount.get('request')
  const formCubeIds = Object.keys(form)
  if (request) {
    const requestedCubeIds = formCubeIds.filter(cubeId => request.changes.fmCounts[0]?.[cubeId] || request.changes.fmCounts[1]?.[cubeId])
    if (requestedCubeIds.length) {
      throw new Error('Es gibt eine Anfrage für: ' + requestedCubeIds.join(', '))
    }
  }
  const fmCounts = frameMount.get('fmCounts') || {}
  // if anyof the form cubeIds is not currently mounted throw an error
  const notMountedCubeIds = Object.keys(form).filter(cubeId => !fmCounts[cubeId])
  if (notMountedCubeIds.length) {
    throw new Error('Demontageauftrag hat CityCubes, der derzeit nicht montiert sind: ' + notMountedCubeIds.join(', '))
  }
  for (const cubeId of Object.keys(form)) {
    form[cubeId].qty = fmCounts[cubeId]
  }
  const takedowns = { ...(frameMount.get('takedowns') || {}), ...form }
  const changes = $changes(frameMount, { takedowns })
  const audit = { user, fn: 'frame-mount-takedown-request', data: { changes } }
  await $notify({
    usersQuery: $query(Parse.User).equalTo('company', frameMount.get('company')).equalTo('permissions', 'manage-frames'),
    identifier: 'frame-mount-takedown-request',
    data: { frameMountId, pk: frameMount.get('pk'), cubeIds: Object.keys(form) }
  })
  await frameMount.set({ takedowns }).save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Demontageauftrag gesendet.'
}, $internFrameManager)

Parse.Cloud.define('frame-mount-takedown-request-accept', async ({ params: { id: frameMountId, cubeId, date }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const takedowns = frameMount.get('takedowns') || {}
  if (!takedowns[cubeId]) {
    throw new Error('Takedown request not found')
  }
  const qty = frameMount.get('fmCounts')?.[cubeId]
  if (!qty) {
    throw new Error('Frame Mount has cube that is not currently mounted')
  }
  takedowns[cubeId].acceptedBy = user?.toPointer()
  takedowns[cubeId].acceptedAt = new Date()
  takedowns[cubeId].qty = qty
  takedowns[cubeId].date = date
  frameMount.set({ takedowns })
  const audit = { user, fn: 'frame-mount-takedown-request-accept', data: { cubeId } }
  return frameMount.set({ takedowns }).save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, $isFrameManager)

Parse.Cloud.define('frame-mount-takedown-revert', async ({ params: { id: frameMountId, cubeId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const takedowns = frameMount.get('takedowns') || {}
  if (!takedowns[cubeId]) {
    throw new Error('Takedown request not found')
  }
  // if takedown was accepted then revert the qty
  const wasDismantled = takedowns[cubeId].date
  if (wasDismantled && takedowns[cubeId].qty) {
    // first check if the cube is available
    const cube = await $getOrFail('Cube', cubeId)
    if (cube.get('order') || cube.get('futureOrder')) {
      throw new Error('CityCube ist nicht mehr verfügbar')
    }
    const fmCounts = frameMount.get('fmCounts') || {}
    fmCounts[cubeId] = takedowns[cubeId].qty
    frameMount.set({ fmCounts })
  }
  delete takedowns[cubeId]
  frameMount.set({ takedowns })
  const audit = { user, fn: 'frame-mount-takedown-revert', data: { cubeId, wasDismantled } }
  return frameMount.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, $isFrameManager)

Parse.Cloud.define('frame-mount-takedown-requests', async () => {
  const pendingTakedownRequests = []
  await $query('FrameMount')
    .equalTo('status', 3)
    .notEqualTo('takedowns', null)
    .each(async (frameMount) => {
      const takedowns = frameMount.get('takedowns')
      for (const cubeId in takedowns) {
        const takedown = takedowns[cubeId]
        if (!takedown.date) {
          pendingTakedownRequests.push({
            frameMount: frameMount.toJSON(),
            cube: await $getOrFail('Cube', cubeId),
            takedown
          })
        }
      }
    }, { useMasterKey: true })
  return pendingTakedownRequests
}, { requireUser: true })

Parse.Cloud.define('frame-mount-toggle-star', async ({ params: { id: frameMountId, cubeId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  const stars = frameMount.get('stars') || {}
  const starred = !stars[cubeId]
  stars[cubeId] = starred || undefined
  frameMount.set({ stars: $cleanDict(stars) })
  await frameMount.save(null, { useMasterKey: true })
  return starred
}, $internFrameManager)

// Used in RkFrameLocations to display counts
Parse.Cloud.define('frame-mount-locations', () => {
  return $query('FrameMount')
    .aggregate([
      { $group: { _id: '$pk', count: { $sum: 1 } } }
    ], { useMasterKey: true })
    .then(results => results.reduce((acc, { objectId, count }) => {
      acc[objectId] = count
      return acc
    }, {}))
}, $internOrAdmin)
