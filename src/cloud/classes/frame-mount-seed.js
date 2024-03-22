const { indexCubes, randomCubes } = require('@/cloud/search')
const FrameMount = Parse.Object.extend('FrameMount')

async function cleanUpFrameMounts () {
  if (!DEVELOPMENT) { return }
  await $query('FrameMount')
    .each((frameMount) => {
      frameMount
        .set('cubeIds', [])
        .set('fmCounts', null)
        .set('takedowns', null)
        .set('cubeHistory', null)
        .set('status', 2)
        .unset('reservedUntil')
        .unset('request')
        .unset('requestHistory')
      return frameMount.save(null, { useMasterKey: true, context: { setCubeStatuses: true } })
    }, { useMasterKey: true })
}

cleanUpFrameMounts().then(() => {
  consola.info('cleaned up frame mounts')
})

async function seedTest ({ params: { pk } }) {
  await cleanUpFrameMounts()
  const frameMountsQuery = $query(FrameMount)
    .notEqualTo('planned', null)
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

Parse.Cloud.define('seed-frame-mount-tests', seedTest, { requireMaster: true })
// Parse.Cloud.run('seed-frame-mount-tests', { pk: 'BW:Heidelberg' }, { useMasterKey: true })
// Parse.Cloud.run('seed-frame-mount-tests', {}, { useMasterKey: true })
