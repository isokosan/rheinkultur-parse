const { faker } = require('./../utils')
require('./TLK')
require('./SGSW')
require('./TBS')

const seed = async () => {
  consola.info('seeding telekom cubes')
  // await seedTelekom()
  consola.success('seeded telekom cubes')
}

async function getRandomCubeIds (pagination, verify = true, inSolingen = false) {
  const longitude = inSolingen
    ? faker.address.longitude(7.3, 6.9)
    : faker.address.longitude(14, 6.9)
  const latitude = inSolingen
    ? faker.address.latitude(51.3, 50.9)
    : faker.address.latitude(53, 47)
  const c = [longitude, latitude].join(',')
  const cubeIds = await Parse.Cloud.run('search', {
    c,
    r: 200000,
    v: '0',
    verifiable: true,
    pagination
  }).then(results => results.hits.map(({ _id }) => _id))

  if (verify) {
    for (const id of cubeIds) {
      await Parse.Cloud.run('cube-verify', { id }, { useMasterKey: true }).catch(consola.error)
    }
  }
  return cubeIds
}

const getRandomCubePrice = function (media) {
  return faker.helpers.arrayElement(media === 'MFG' ? [90, 100, 110, 120] : [90, 80, 70, 60])
}

// const checkIds = async (destroy) => {
//   const cubes = await $query('Cube')
//     .matches('objectId', /[^A-Za-z0-9ÄÖÜäöüß*_/()-]/g)
//     .select('')
//     .find({ useMasterKey: true })
//   consola.info(cubes.map(c => c.id))
//   destroy === true && Parse.Object.destroyAll(cubes, { useMasterKey: true })
// }

// const purgeCubes = async () => {
//   const { wait } = require('@/utils')
//   let i = 11
//   while (i--) {
//     consola.warn('WILL PURGE ALL CUBES in ' + i + ' seconds')
//     await wait(1)
//   }
//   consola.info('purging schema and search indexes')
//   await (new Parse.Schema('Cube')).purge()
//   await (new Parse.Schema('SkippedCubeImport')).purge()
//   consola.success('schema purged')
//   const { purgeIndexes } = require('@/cloud/search')
//   await purgeIndexes()
//   consola.success('search indexes purged')
// }

// const updateCubes = async () => {
//   const fields = [
//     'nMR',
//     'MBfD',
//     'PG',
//     'Agwb',
//     'TTMR'
//   ]
//   const existsQueries = fields.map(field => $query('Cube').exists(field))
//   while (true) {
//     const { results: cubes, count } = await Parse.Query.or(...existsQueries).limit(100)
//       .withCount()
//       .find({ useMasterKey: true })
//     for (const cube of cubes) {
//       const warnings = {}
//       for (const field of fields) {
//         warnings[field] = cube.get(field)
//         cube.unset(field)
//       }
//       cube.set({ warnings })
//       await cube.save(null, { useMasterKey: true })
//     }
//     consola.info(`Remaining: ${count - cubes.length}`)
//   }
// }
// updateCubes()

// const getListOfMBfD = async () => {
//   const all = require('@/../imports/TLK_cubes_2022-10-24.json')
//   const cubeIds = all.filter(({ ausbautreiber, ausbautreiber1 }) => ausbautreiber === 'MBfD' || ausbautreiber1 === 'MBfD').map(({ KVZ_ID }) => 'TLK-' + KVZ_ID)
//   return require('fs').writeFileSync('MBfD.json', JSON.stringify(cubeIds, null, 2))
// }
// getListOfMBfD()

module.exports = {
  getRandomCubeIds,
  getRandomCubePrice,
  seed
}
