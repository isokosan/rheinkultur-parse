const { syncBlacklistCubeFlags } = require('@/cloud/classes/plzs')
const { PDGA } = require('@/cloud/cube-flags')

module.exports = async function (job) {
  let i = 0
  const response = { bPLZs: 0, cleanedbPLZs: 0, PDGAs: 0, cleanedPDGAs: 0 }
  const bPLZsQuery = $query('PLZ').equalTo('nMR', true)
  const bPLZs = await bPLZsQuery.distinct('objectId', { useMasterKey: true })
  const PDGAs = Object.keys(PDGA)
  const total = bPLZs.length + PDGAs.length
  await bPLZsQuery
    .eachBatch(async (plzs) => {
      for (const plz of plzs) {
        response.bPLZs += await syncBlacklistCubeFlags(plz)
        i++
      }
      job.progress(parseInt(100 * i / total))
    }, { useMasterKey: true })

  // cleanup
  await $query('Cube')
    .equalTo('flags', 'bPLZ')
    .notContainedIn('plz', bPLZs)
    .eachBatch(async (cubes) => {
      for (const cube of cubes) {
        const flags = cube.get('flags') || []
        cube.set('flags', flags.filter(flag => flag !== 'bPLZ'))
        await $saveWithEncode(cube, null, { useMasterKey: true })
        response.cleanedbPLZs++
      }
    }, { useMasterKey: true })

  for (const pk of PDGAs) {
    await $query('Cube')
      .equalTo('pk', pk)
      .notEqualTo('flags', 'PDGA')
      .eachBatch(async (cubes) => {
        for (const cube of cubes) {
          const flags = cube.get('flags') || []
          cube.set('flags', [...flags, 'PDGA'])
          await $saveWithEncode(cube, null, { useMasterKey: true })
          response.PDGAs++
          i++
        }
        job.progress(parseInt(100 * i / total))
      }, { useMasterKey: true })
  }
  // cleanup
  await $query('Cube')
    .equalTo('flags', 'PDGA')
    .notContainedIn('pk', PDGAs)
    .eachBatch(async (cubes) => {
      for (const cube of cubes) {
        const flags = cube.get('flags') || []
        cube.set('flags', flags.filter(flag => flag !== 'PDGA'))
        await $saveWithEncode(cube, null, { useMasterKey: true })
        response.cleanedPDGAs++
      }
    }, { useMasterKey: true })

  return Promise.resolve(response)
}
