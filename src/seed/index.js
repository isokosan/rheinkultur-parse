/* eslint-disable no-unused-vars */
const { promisify } = require('node:util')
const request = promisify(require('request'))
const redis = require('@/services/redis')
const { getCountries } = require('@/services/lex')
const { createMediae } = require('@/cloud/classes/mediae')
DEVELOPMENT && require('./cubes')
require('./orders')
const { runWhileFn } = require('./utils')
const { seed: seedUsers } = require('./users')
const { seed: seedPlzs } = require('./plzs')
const { seed: seedStates } = require('./states')
const { seed: seedHousingTypes } = require('./housing-types')
const { seed: seedPrintPackages } = require('./print-packages')
const { seed: seedCompanies, seedAddresses } = require('./companies')
const seedTags = function () {
  const TAGS = ['ALDI', 'ALDI SÜD', 'ALDI NORD']
  const requests = TAGS.map(tag => ({
    method: 'POST',
    path: '/parse/classes/Tag/',
    body: { objectId: tag, name: tag }
  }))
  return request({
    url: `${process.env.PUBLIC_SERVER_URL}/batch`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-MASTER-Key': process.env.MASTER_KEY
    },
    json: true,
    body: { requests }
  })
}

const seedGradualPriceMaps = () => {
  const requests = [{
    method: 'POST',
    path: '/parse/classes/GradualPriceMap/',
    body: {
      objectId: 'ALDI',
      code: 'ALDI',
      map: {
        0: 58,
        500: 48,
        1500: 38,
        4000: 28
      }
    }
  }]
  return request({
    url: `${process.env.PUBLIC_SERVER_URL}/batch`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-MASTER-Key': process.env.MASTER_KEY
    },
    json: true,
    body: { requests }
  })
}

async function cleanCubes () {
  consola.info('cleaning cubes')
  const fields = [
    'vAt',
    'sAt',
    'cAt',
    'dAt',
    'order',
    'p1',
    'p2'
  ]
  const existsQueries = fields.map(field => $query('Cube').exists(field))
  let i = 0
  while (true) {
    const query = Parse.Query.or(...existsQueries).limit(100)
    const { results: cubes, count } = await query.withCount().find({ useMasterKey: true })
    if (!cubes.length) {
      break
    }
    consola.info(`cleaning ${cubes.length} cubes of ${count} remaining`)
    for (const cube of cubes) {
      for (const field of fields) {
        cube.unset(field)
      }
      await cube.save(null, { useMasterKey: true })
    }
    i += cubes.length
  }
  consola.success('cleaned all cubes')
  return Promise.resolve(i)
}
async function cleanFileObjects () {
  let i = 0
  while (true) {
    const files = await $query('FileObject')
      .notContainedIn('assetType', ['print-template'])
      .limit(10)
      .find({ useMasterKey: true })
    if (!files.length) {
      break
    }
    for (const file of files) {
      await file.destroy({ useMasterKey: true })
      i++
    }
  }
  return i
}
async function cleanCubePhotos () {
  let i = 0
  while (true) {
    const photos = await $query('CubePhoto')
      .limit(10)
      .find({ useMasterKey: true })
    if (!photos.length) {
      break
    }
    for (const photo of photos) {
      await photo.destroy({ useMasterKey: true })
      i++
    }
  }
  return i
}

const staticClasses = [
  '_Role',
  '_Session',
  '_User',
  'Company',
  'Address',
  'Person',
  // 'Cube', do not purge!
  'PrintPackage',
  'GradualPriceMap',
  'Media',
  'Tag',
  'HousingType'
  // 'State'
  // 'PLZ'
]

const dynamicClasses = [
  'Audit',
  'Booking',
  // 'CubePhoto', // instead delete one by one
  'Comment',
  'Contract',
  'Invoice',
  'CreditNote',
  'Production',
  // agency-lessor totals
  'AgencyTotal',
  'LessorTotal',
  // /scouting
  'Briefing',
  'Control',
  'DepartureList',
  'ScoutSubmission',
  'ControlSubmission'
]

const initCache = async () => {
  await getCountries()
}

// Needs to be run on the server
const purgeSeed = async function () {
  await redis.flushdb().catch(consola.error)
  await Promise.all(staticClasses.map(className => (new Parse.Schema(className)).purge()))
  consola.success('Static schemas purged')
  await initCache()
  // await seedStates()
  // await seedPlzs()
  await seedHousingTypes()
  await seedPrintPackages()
  await createMediae()
  await seedTags()
  await seedGradualPriceMaps()
  consola.success('Static classes seeded')
  await Promise.all(dynamicClasses.map(className => (new Parse.Schema(className)).purge()))
  consola.success('Dynamic schemas purged')
  const cleanedCubes = await cleanCubes()
  consola.success(`Cleaned ${cleanedCubes} cubes`)
  const cleanedCubePhotos = await cleanCubePhotos()
  consola.success(`Cleaned ${cleanedCubePhotos} cube photos`)
  const cleanedFileObjects = await cleanFileObjects()
  consola.success(`Cleaned ${cleanedFileObjects} file objects`)
  await seedUsers()
  await seedCompanies()
  await seedAddresses()
  consola.success('done purge-seed')
}

Parse.Cloud.define('seed-housing-types', () => {
  seedHousingTypes()
  return 'ok'
}, { requireMaster: true })

Parse.Cloud.define('seed-print-packages', () => {
  seedPrintPackages()
  return 'ok'
}, { requireMaster: true })

Parse.Cloud.define('purge-seed', async () => {
  await Parse.Config.save({ today: moment().format('YYYY-MM-DD') })
  purgeSeed()
  return 'ok'
}, { requireMaster: true })

Parse.Cloud.define('clean-cubes', () => {
  cleanCubes()
  return 'ok'
}, { requireMaster: true })
