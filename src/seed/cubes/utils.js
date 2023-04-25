const getPlzDict = require('./../plzs/dict')

const cleanVal = (val) => {
  if (typeof val === 'string') {
    if (['\n', '\\n', '\\N', '-', 'Unbekannt', 'unbekannt'].includes(val)) {
      return undefined
    }
    val = val?.trim() || undefined
  }
  return val
}

const prepareDicts = async () => {
  const plzs = getPlzDict()
  // init custom maps
  const states = {}
  for (const state of await $query('State').find({ useMasterKey: true })) {
    states[state.get('name')] = $pointer('State', state.id)
  }
  if (!Object.keys(states).length) {
    throw new Error('Please run purge-seed before seeding cubes')
  }
  const hts = {}
  for (const ht of await $query('HousingType').find({ useMasterKey: true })) {
    hts[ht.get('code')] = ht
  }
  if (!Object.keys(states).length) {
    throw new Error('Please run purge-seed before seeding cubes')
  }
  return { plzs, states, hts }
}

const getCubeId = async (lc, date, i, row, column) => {
  const cubeId = row[column]
  if (!cubeId) {
    return skipCubeImport({ lc, date, i, e: column + ' empty' })
  }
  const objectId = cubeId.startsWith(lc + '-')
    ? cubeId
    : lc + '-' + cubeId
  if (!(/^[A-Za-z0-9ÄÖÜäöüß*_/()-]+$/).test(objectId)) {
    return skipCubeImport({ lc, date, i, cubeId: objectId, e: column + ' contains bad character' })
  }
  return objectId
}

async function skipCubeImport (fields) {
  if (!fields.lc || !fields.i) {
    throw new Error('skipCubeImport: lc and i are required')
  }
  consola.error(JSON.stringify(fields))
  const SkippedCubeImport = Parse.Object.extend('SkippedCubeImport')
  const importError = await $query(SkippedCubeImport)
    .equalTo('lc', fields.lc)
    .equalTo('date', fields.date || null)
    .equalTo('i', fields.i)
    .first({ useMasterKey: true }) || new SkippedCubeImport()
  await importError.set(fields).save(null, { useMasterKey: true })
  return false
}

const getLastImportedRow = async (lc, date) => {
  if (!lc) {
    throw new Error('getLastImportedRow: lc is required')
  }
  const lastCube = await $query('Cube')
    .equalTo('lc', lc)
    .equalTo('importData.date', date || null)
    .descending('i')
    .first({ useMasterKey: true })
    .then(c => c?.get('i') || 0)
  const lastError = await $query('SkippedCubeImport')
    .equalTo('lc', lc)
    .equalTo('date', date || null)
    .descending('i')
    .first({ useMasterKey: true })
    .then(iE => iE?.get('i') || 0)
  return Math.max(lastCube, lastError)
}
const getAllImportedRows = async (lc, date) => {
  if (!lc) {
    throw new Error('getAllImportedRows: lc and date are required')
  }
  const cubes = await $query('Cube')
    .equalTo('lc', lc)
    .equalTo('importData.date', date || null)
    .distinct('i', { useMasterKey: true })
  const errors = await $query('SkippedCubeImport')
    .equalTo('lc', lc)
    .equalTo('date', date || null)
    .distinct('i', { useMasterKey: true })
  return [...cubes, ...errors]
}

const axios = require('axios')
const seedCube = async (body, seeding = true) => axios({
  method: 'POST',
  url: `${process.env.PUBLIC_SERVER_URL}/classes/Cube`,
  headers: {
    'Content-Type': 'application/json;charset=utf-8',
    'X-Parse-Application-Id': process.env.APP_ID,
    'X-Parse-Master-Key': process.env.MASTER_KEY,
    'X-Parse-Cloud-Context': JSON.stringify({ seeding })
  },
  data: body
})

module.exports = {
  cleanVal,
  prepareDicts,
  getCubeId,
  skipCubeImport,
  getLastImportedRow,
  getAllImportedRows,
  seedCube
}
