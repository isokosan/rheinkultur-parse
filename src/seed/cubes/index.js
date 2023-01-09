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

module.exports = {
  getRandomCubeIds,
  getRandomCubePrice,
  seed
}
