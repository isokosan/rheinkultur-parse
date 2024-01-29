// ([^\d]*\s*[^\d]+) .* ([^\d]*\s*[^\d]+) \d (.*)\n
// { ort: '$1', state: '$2', planned: $3 },\n
const { fetchStates } = require('./states')
const LOCATION_LIST = [
  { ort: 'Karlsruhe', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Heilbronn', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Mannheim ', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Freiburg im Breisgau ', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Baden-Baden', state: 'Baden-Württemberg', planned: 100 },
  { ort: 'Böblingen', state: 'Baden-Württemberg', planned: null },
  { ort: 'Esslingen am Neckar', state: 'Baden-Württemberg', planned: null },
  { ort: 'Heidelberg ', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Leonberg ', state: 'Baden-Württemberg', planned: null },
  { ort: 'Ludwigsburg', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Pforzheim', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Reutlingen ', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Sindelfingen ', state: 'Baden-Württemberg', planned: null },
  { ort: 'Tübingen ', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Ulm', state: 'Baden-Württemberg', planned: null },
  { ort: 'Bodensee-Netz', state: 'Baden-Württemberg', planned: null },
  { ort: 'Stuttgart', state: 'Baden-Württemberg', planned: 250 },
  { ort: 'Augsburg ', state: 'Bayern ', planned: 100 },
  { ort: 'Bayreuth ', state: 'Bayern ', planned: null },
  { ort: 'Ingolstadt ', state: 'Bayern ', planned: 50 },
  { ort: 'Passau ', state: 'Bayern ', planned: null },
  { ort: 'Marburg', state: 'Hessen ', planned: null },
  { ort: 'Wiesbaden', state: 'Hessen ', planned: 150 },
  { ort: 'Braunschweig ', state: 'Niedersachsen', planned: 200 },
  { ort: 'Oldenburg (Oldenburg)', state: 'Niedersachsen', planned: 50 },
  { ort: 'Dortmund ', state: 'Nordrhein-Westfalen', planned: 250 },
  { ort: 'Düsseldorf ', state: 'Nordrhein-Westfalen', planned: 300 },
  { ort: 'Mülheim an der Ruhr', state: 'Nordrhein-Westfalen', planned: 100 },
  { ort: 'Bonn ', state: 'Nordrhein-Westfalen', planned: 200 },
  { ort: 'Bottrop', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Gütersloh', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Recklinghausen ', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Münster', state: 'Nordrhein-Westfalen', planned: 250 },
  { ort: 'Bielefeld', state: 'Nordrhein-Westfalen', planned: 150 },
  { ort: 'Hamm ', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Paderborn', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Ludwigshafen am Rhein', state: 'Rheinland-Pfalz', planned: 50 },
  { ort: 'Kaiserslautern ', state: 'Rheinland-Pfalz', planned: null },
  { ort: 'Koblenz', state: 'Rheinland-Pfalz', planned: 100 },
  { ort: 'Trier', state: 'Rheinland-Pfalz', planned: 100 },
  { ort: 'Chemnitz ', state: 'Sachsen', planned: 150 },
  { ort: 'Dresden', state: 'Sachsen', planned: 200 },
  { ort: 'Leipzig', state: 'Sachsen', planned: 250 },
  { ort: 'Halle (Saale)', state: 'Sachsen-Anhalt ', planned: 100 },
  { ort: 'Magdeburg', state: 'Sachsen-Anhalt ', planned: 150 },
  { ort: 'Flensburg', state: 'Schleswig-Holstein ', planned: null },
  { ort: 'Lüneburg ', state: 'Schleswig-Holstein ', planned: null }
].map((city) => {
  city.ort = city.ort.trim()
  city.state = city.state.trim()
  return city
})

const { countCubes } = require('@/cloud/search')
// Force company
const companyId = '19me3Ge8LZ'

Parse.Cloud.define('frames-locations', async ({ params: { force }, user }) => {
  const isFramesManager = user.get('permissions').includes('manage-frames')
  if (!isFramesManager) {
    throw new Parse.Error(401, 'Unauthorized')
  }
  const cacheKey = companyId ? 'frames-' + companyId : 'locations'
  return $cache(cacheKey, {
    async cacheFn () {
      const states = await fetchStates()
      const locations = LOCATION_LIST.map((location) => {
        location.stateId = Object.values(states).find((state) => state.name === location.state)?.objectId
        if (!location.stateId) { throw new Error(location.state) }
        location.placeKey = [location.stateId, location.ort].join(':')
        return location
      })
      const wawiCities = await $query('City').containedIn('objectId', locations.map(l => l.placeKey)).select('population').find({ useMasterKey: true })
      const scoutLists = await $query('TaskList')
        .equalTo('type', 'scout')
        .matchesQuery('briefing', $query('Briefing').equalTo('company', $parsify('Company', companyId)))
        .containedIn('pk', locations.map(l => l.placeKey))
        .limit(locations.length * 2)
        .find({ useMasterKey: true })

      return {
        locations: await Promise.all(locations.map(async (location) => {
          location.wawiCity = wawiCities.find((c) => c.id === location.placeKey)
          location.population = location.wawiCity?.get('population')
          location.taskLists = scoutLists.filter((list) => list.get('pk') === location.placeKey)
          // get counts
          location.counts = location.taskLists.reduce((acc, list) => {
            const counts = list.get('counts') || {}
            for (const key of Object.keys(counts)) {
              acc[key] = (acc[key] || 0) + counts[key]
            }
            return acc
          }, {})
          if (!location.counts.total && location.wawiCity) {
            location.counts.total = await countCubes({
              filter: [
                { term: { 'ort.keyword': location.ort } },
                { term: { 'state.objectId.keyword': location.stateId } }
              ],
              must: [
                { range: { s: { lt: 5 } } }
              ]
            })
          }
          if (location.counts.total) {
            location.cubes = location.counts.total
            location.progress = parseInt((location.counts.completed / location.counts.total) * 100)
          }
          return location
        }))
      }
    },
    maxAge: [5, 'minutes'],
    force
  })
}, { requireUser: true })

// TEMPORARY FUNCTION
Parse.Cloud.define('frames-rejections', async ({ params: { taskListIds }, user }) => {
  const isFramesManager = user.get('permissions').includes('manage-frames')
  if (!isFramesManager) {
    throw new Parse.Error(401, 'Unauthorized')
  }
  const taskListsQuery = await $query('TaskList').containedIn('objectId', taskListIds)
  return $query('ScoutSubmission')
    .matchesQuery('taskList', taskListsQuery)
    .equalTo('status', 'rejected')
    .include('cube')
    .find({ useMasterKey: true })
}, { requireUser: true })

// function calculateRemainingTakedownQuota() {
//   const allowedTakedownRate = 0.1
//   const items = [
//     { type: 'mount', count: 200 },
//     { type: 'takedown', count: 20 },
//     { type: 'mount', count: 50 },
//     { type: 'unmount', count: 15 },
//     { type: 'takedown', count: 1 },
//     { type: 'mount', count: 100 }
//   ]
//   // should be 30 * 10% = 3 takedowns remaining
//   const mounts = items.filter((m) => m.type === 'mount').reduce((acc, { count }) => acc + count, 0)
//   const unmounts = items.filter((m) => m.type === 'unmount').reduce((acc, { count }) => acc + count, 0)
//   const takedowns = items.filter((m) => m.type === 'takedown').reduce((acc, { count }) => acc + count, 0)
//   const active = mounts - (unmounts + takedowns)
//   const remainingTakedownQuota = Math.floor(active * allowedTakedownRate) - takedowns
//   console.log({ mounts, unmounts, takedowns, active, remainingTakedownQuota })
//   return remainingTakedownQuota
// }
// calculateRemainingTakedownQuota()

/*
const { frameMounts: { UNSET_NULL_FIELDS, normalizeFields } } = require('@/schema/normalizers')
const {
  getNewNo,
  validateOrderFinalize,
  setOrderCubeStatuses,
  getLastRemovedCubeIds,
  earlyCancelSpecialFormats
} = require('@/shared')

const FrameMount = Parse.Object.extend('FrameMount')

Parse.Cloud.beforeSave(FrameMount, async ({ object: frameMount }) => {
  frameMount.isNew() && !frameMount.get('no') && frameMount.set({ no: await getNewNo('MR' + moment(await $today()).format('YY') + '-', FrameMount, 'no') })
  UNSET_NULL_FIELDS.forEach(field => !frameMount.get(field) && frameMount.unset(field))

  frameMount.set('totalDuration', (frameMount.get('initialDuration') || 0) + (frameMount.get('extendedDuration') || 0))
  const canceled = Boolean(frameMount.get('canceledAt') || frameMount.get('voidedAt'))
  !canceled && frameMount.set('autoExtendsAt', frameMount.get('autoExtendsBy') ? moment(frameMount.get('endsAt')).subtract(frameMount.get('noticePeriod') || 0, 'months').format('YYYY-MM-DD') : null)

  // cubes
  const cubeIds = frameMount.get('cubeIds') || []
  if (cubeIds.length > CUBE_LIMIT) {
    throw new Error(`Es können maximal ${CUBE_LIMIT} CityCubes pro Auftrag hinzugefügt werden.`)
  }
  cubeIds.sort()
  frameMount.set('cubeIds', cubeIds).set('cubeCount', cubeIds.length)
})

Parse.Cloud.afterSave(FrameMount, async ({ object: frameMount, context: { audit, setCubeStatuses } }) => {
  setCubeStatuses && await setOrderCubeStatuses(frameMount)
  audit && $audit(frameMount, audit)
})

Parse.Cloud.beforeFind(FrameMount, ({ query }) => {
  query._include.includes('all') && query.include([
    'company',
    'docs',
    'tags',
    'lastRemovedCubeIds'
  ])
})

Parse.Cloud.afterFind(FrameMount, async ({ objects: frameMounts, query }) => {
  for (const frameMount of frameMounts) {
    // get computed property willExtend
    const willExtend = frameMount.get('autoExtendsBy') && !frameMount.get('canceledAt') && !frameMount.get('voidedAt')
    frameMount.set('willExtend', willExtend)

    if (query._include.includes('lastRemovedCubeIds') && frameMount.get('status') >= 0 && frameMount.get('status') <= 2.1) {
      frameMount.set('lastRemovedCubeIds', await getLastRemovedCubeIds('FrameMount', frameMount.id))
    }
  }
  return frameMounts
})

Parse.Cloud.beforeDelete(FrameMount, async ({ object: frameMount }) => {
  if (frameMount.get('status') !== 0 && frameMount.get('status') !== 2) {
    throw new Error('Nur Aufträge im Entwurfsstatus können gelöscht werden!')
  }
})

Parse.Cloud.afterDelete(FrameMount, async ({ object: frameMount }) => {
  $deleteAudits({ object: frameMount })
})

Parse.Cloud.define('frame-mount-create', async ({ params, user, master }) => {
  const {
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    disassemblyFromRMV
  } = normalizeFields(params)

  const company = await $getOrFail('Company', companyId)
  const frameMount = new FrameMount({
    status: 2,
    company,
    companyPerson: companyPersonId ? await $getOrFail('Person', companyPersonId) : undefined,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    responsibles: user ? [$pointer(Parse.User, user.id)] : undefined,
    tags: company.get('tags'),
    disassembly: disassemblyFromRMV
      ? { fromRMV: true }
      : null
  })
  const audit = { user, fn: 'frame-mount-create' }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-update-cubes', async ({ params: { id: frameMountId, ...params }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId, 'company')
  if (frameMount.get('status') >= 3) {
    throw new Error('CityCubes von finalisierte Aufträge können nicht mehr geändert werden.')
  }

  const { cubeIds } = normalizeFields(params)
  const cubeChanges = $cubeChanges(frameMount, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  frameMount.set({ cubeIds })

  const audit = { user, fn: 'frame-mount-update', data: { cubeChanges } }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-update', async ({ params: { id: frameMountId, ...params }, user }) => {
  const {
    cubeIds,
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    disassemblyFromRMV
  } = normalizeFields(params)

  const frameMount = await $getOrFail(FrameMount, frameMountId, ['all'])
  if (frameMount.get('status') >= 3) {
    throw new Error('Finalisierte Aufträge können nicht mehr geändert werden.')
  }

  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(frameMount, cubeIds)
  cubeChanges && frameMount.set({ cubeIds })

  const changes = $changes(frameMount, {
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy
  })
  frameMount.set({
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy
  })

  const disassembly = frameMount.get('disassembly') || {}
  // add disassemblyFromRMV
  if (disassemblyFromRMV !== Boolean(disassembly.fromRMV)) {
    changes.disassemblyFromRMV = [Boolean(disassembly.fromRMV), disassemblyFromRMV]
    disassembly.fromRMV = disassemblyFromRMV
    frameMount.set({ disassembly })
  }

  if (companyId !== frameMount.get('company')?.id) {
    changes.companyId = [frameMount.get('company')?.id, companyId]
    const company = await $getOrFail('Company', companyId, ['tags'])
    frameMount.set({ company })
    // override company tags
    company.get('tags') ? frameMount.set('tags', company.get('tags')) : frameMount.unset('tags')
  }
  if (companyPersonId !== frameMount.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [frameMount.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    frameMount.set({ companyPerson })
  }

  frameMount.get('status') === 1 && frameMount.set('status', 0)

  const audit = { user, fn: 'frame-mount-update', data: { changes, cubeChanges } }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-finalize', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  await validateOrderFinalize(frameMount)

  // check if any special formats need to be canceled early
  await earlyCancelSpecialFormats(frameMount)

  frameMount.set({ status: 3 })
  const audit = { user, fn: 'frame-mount-finalize' }
  await frameMount.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Sonderformat finalisiert.'
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
*/
