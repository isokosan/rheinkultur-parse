const { indexCubes, randomCubes } = require('@/cloud/search')
const { fetchStates } = require('./states')
// initialize tests
const FrameMount = Parse.Object.extend('FrameMount')
// Force company
const companyId = '19me3Ge8LZ'
const company = $parsify('Company', companyId)

async function initializeFrameMounts () {
  if (DEVELOPMENT) {
    const schema = new Parse.Schema('FrameMount')
    await schema.purge({ useMasterKey: true })
    console.log('all frame mounts removed')
  }
  const exists = await $query('FrameMount').equalTo('company', company).first({ useMasterKey: true })
  if (exists) {
    return consola.info('frame mounts already initialized')
  }
  const states = await fetchStates()
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
    // { ort: 'Bodensee-Netz', state: 'Baden-Württemberg', planned: null },
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
    { ort: 'Lüneburg ', state: 'Niedersachsen', planned: null }
  ].map((city) => {
    city.ort = city.ort.trim()
    city.state = city.state.trim()
    return city
  })
  const locations = LOCATION_LIST
    .filter(location => location.planned !== null)
    .map((location) => {
      location.stateId = Object.values(states).find((state) => state.name === location.state)?.objectId
      if (!location.stateId) { throw new Error(location.state) }
      location.placeKey = [location.stateId, location.ort].join(':')
      return location
    })
  for (const location of locations) {
    // check if exists
    const item = await $query('FrameMount')
      .equalTo('pk', location.placeKey)
      .equalTo('company', company)
      .first({ useMasterKey: true }) || new FrameMount({
      pk: location.placeKey,
      company,
      status: 0
    })
    item.set('planned', location.planned)
    await item.save(null, { useMasterKey: true })
  }
  // now transition flag TTMR'S
  const cubes = await $query('Cube').equalTo('flags', 'TTMR')
    .limit(1000)
    .select('pk')
    .find({ useMasterKey: true })
  const pks = {}
  for (const cube of cubes) {
    pks[cube.get('pk')] = pks[cube.get('pk')] || []
    pks[cube.get('pk')].push(cube.id)
  }
  for (const pk of Object.keys(pks)) {
    const fm = await $query('FrameMount').equalTo('pk', pk).first({ useMasterKey: true })
    if (!fm) {
      console.log(pk)
      continue
    }
    await fm.set('cubeIds', pks[pk]).save(null, { useMasterKey: true })
  }
  consola.success('frame mounts initialized')
}

async function seedTest ({ params: { pk } }) {
  await initializeFrameMounts()
  const frameMountsQuery = $query(FrameMount)
    .equalTo('company', company)
    .notEqualTo('planned', null)
  await $query('Cube')
    .notEqualTo('fmk', null)
    .eachBatch(async (cubes) => {
      for (const cube of cubes) {
        cube.unset('fm')
        await $saveWithEncode(cube, null, { useMasterKey: true })
      }
    }, { useMasterKey: true })

  // return
  pk && frameMountsQuery.equalTo('pk', pk)
  await frameMountsQuery.each(async (frameMount) => {
    consola.info('seeding', frameMount.get('pk'))
    const planned = frameMount.get('planned')
    // reindex all the cubes in the pk
    await $query('Cube').equalTo('pk', frameMount.get('pk')).eachBatch(indexCubes, { useMasterKey: true })

    // pick randomly from available cubes, 1.5 times the quota (planned)
    const freeUpCount = parseInt(planned * 1.5)
    const { results } = await randomCubes({
      filter: [
        { term: { 'pk.keyword': frameMount.get('pk') } }
      ],
      must: [
        { range: { s: { lt: 5 } } }
      ],
      must_not: [
        { exists: { field: 'dAt' } },
        { exists: { field: 'pair' } }
      ]
    }, freeUpCount)
    const cubeIds = results.map((cube) => cube.objectId)
    frameMount.set('cubeIds', cubeIds)
    frameMount.set('status', 3)
    const carry = moment().subtract(1, 'months')
    carry.add(Math.floor(Math.random() * 10), 'days')
    frameMount.set('reservedUntil', carry.clone().add(1, 'month').format('YYYY-MM-DD'))
    await frameMount.save(null, { useMasterKey: true })

    const items = [
      { type: 'update', percent: 75 },
      { type: 'update', percent: 10 },
      { type: 'takedown', percent: 1 }
    ]
    for (const { type, percent } of items) {
      await frameMount.fetch({ useMasterKey: true })
      carry.add(Math.floor(Math.random() * 10), 'days')
      // +- 2 percent but make sure minimum 1
      const randomPercent = percent + (Math.random() < 0.5 ? -1 : 1) * Math.floor(Math.random() * 2)
      const count = Math.max(1, Math.floor(planned * (randomPercent / 100)))
      if (type === 'update') {
        // pick new random cubes to mount
        // pick cubes that have not been mounted, unmounted or takendown at some point
        const cubeIds = await randomCubes({
          filter: [{ terms: { 'objectId.keyword': frameMount.get('cubeIds') } }],
          must: [{ range: { s: { lte: 5 } } }],
          must_not: [
            { exists: { field: 'dAt' } },
            { exists: { field: 'pair' } }
          ]
        }, count).then(({ results }) => results.map((cube) => cube.objectId))
        const fmCounts = frameMount.get('fmCounts') || {}
        for (const cubeId of cubeIds) {
          fmCounts[cubeId] = Math.random() < 0.9 ? 1 : Math.random() < 0.8 ? 2 : 3
        }
        await Parse.Cloud.run('frame-mount-request-draft', { id: frameMount.id, fmCounts }, { useMasterKey: true })
        await Parse.Cloud.run('frame-mount-request-submit', { id: frameMount.id, comments: 'test', date: carry.format('YYYY-MM-DD') }, { useMasterKey: true })
        await Parse.Cloud.run('frame-mount-request-accept', { id: frameMount.id, comments: 'comments' }, { useMasterKey: true })
        await frameMount.fetch({ useMasterKey: true })
      }
      if (type === 'takedown') {
        // pick new random cubes to unmount
        const cubeIds = await randomCubes({
          filter: [
            { terms: { 'objectId.keyword': frameMount.get('cubeIds') } },
            { exists: { field: 'fm.qty' } }
          ]
        }, count).then(({ results }) => results.map((cube) => cube.objectId))
        const takedowns = frameMount.get('takedowns') || {}
        for (const cubeId of cubeIds) {
          const until = carry.format('YYYY-MM-DD')
          takedowns[cubeId] = { until }
        }
        await Parse.Cloud.run('frame-mount-takedown-request', { id: frameMount.id, takedowns }, { useMasterKey: true })
        for (const cubeId of cubeIds) {
          const date = moment(takedowns[cubeId].until).subtract(2, 'days').format('YYYY-MM-DD')
          await Parse.Cloud.run('frame-mount-takedown-request-accept', { id: frameMount.id, cubeId, date }, { useMasterKey: true })
        }
        await frameMount.fetch({ useMasterKey: true })
      }
    }
    console.log('DONE', frameMount.get('pk'))
  }, { useMasterKey: true })
}

Parse.Cloud.define('seed-frame-mount-locations', () => {
  initializeFrameMounts()
  return 'ok'
}, { requireMaster: true })
Parse.Cloud.define('seed-frame-mount-tests', seedTest, { requireMaster: true })
// Parse.Cloud.run('seed-frame-mount-tests', { pk: 'BW:Heidelberg' }, { useMasterKey: true })
// Parse.Cloud.run('seed-frame-mount-tests', {}, { useMasterKey: true })
