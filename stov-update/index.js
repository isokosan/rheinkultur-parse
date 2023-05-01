require('dotenv').config()
const axios = require('axios')
global.Parse = require('parse/node')
Parse.serverURL = process.env.PRODUCTION_SERVER_URL
// Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

const { getPlacesPredictions, getPlaceById } = require('./../src/services/google-maps')
const { parseAsDigitString } = require('./../src/utils')

const {
  cleanVal,
  prepareDicts,
  getCubeId,
  skipCubeImport,
  getAllImportedRows
} = require('./../src/seed/cubes/utils')

const lc = 'TLK'
const date = '2023-04-21'

const seedCube = async (body, seeding = true) => axios({
  method: 'POST',
  url: `${process.env.PRODUCTION_SERVER_URL}/classes/Cube`,
  headers: {
    'Content-Type': 'application/json;charset=utf-8',
    'X-Parse-Application-Id': process.env.APP_ID,
    'X-Parse-Master-Key': process.env.MASTER_KEY,
    'X-Parse-Cloud-Context': JSON.stringify({ seeding })
  },
  data: body
})

async function generateSeedRowFn () {
  const { plzs, states, hts } = await prepareDicts()
  return async function seedRow (i) {
    const row = await axios({ url: 'http://localhost:5001/index/' + i }).then(res => res.data)
    const objectId = await getCubeId(lc, date, i, row, 'kvz_id')
    if (!objectId) { return false }
    // if cube already updated, skip
    if (await $query('Cube').equalTo('objectId', objectId).equalTo('importData.date', date).count({ useMasterKey: true })) {
      // consola.info('Cube already updated', objectId)
      return false
    }

    // if skipped import already exists, skip
    if (await $query('SkippedCubeImport').equalTo('cubeId', objectId).equalTo('date', date).count({ useMasterKey: true })) {
      // consola.info('Import already skipped', objectId)
      return false
    }

    const str = cleanVal(row.strasse)
    const hsnr = cleanVal(row.hs_nr)
    const plz = parseAsDigitString(cleanVal(row.plz), 5)
    const ort = cleanVal(row.ort)
    let state = cleanVal(row.bundesland)

    const importData = {
      i,
      kvzId: cleanVal(row.kvz_id),
      klsId: cleanVal(row.kls_id),
      date,
      str,
      hsnr,
      plz,
      ort,
      state,
      scs_cluster: cleanVal(row.scs_cluster),
      ausbautreiber: cleanVal(row.ausbautreiber),
      ausbautreiber1: cleanVal(row.ausbautreiber1),
      ausbautreiber2: cleanVal(row.ausbautreiber2),
      versorgung: cleanVal(row.versorgung)
    }

    let ht
    const hti = cleanVal(row.kvzgehaeusetyp)
    if (hti && hti in hts) {
      ht = $pointer('HousingType', hts[hti].id)
    }

    // if plz is set but there is no state, attempt to match it from plzsDict
    if (!state || !states[state]) {
      if (plz && plzs[plz]) {
        state = plzs[plz].bundesland
      }
      if (!state || !states[state]) {
        return skipCubeImport({ cubeId: objectId, lc, date, i, e: 'Address not found', input: [str, hsnr, plz, ort].join(' ') })
      }
    }
    state = $pointer('State', states[state].objectId)

    let gp
    try {
      const [latitude, longitude] = [parseFloat(row.breite), parseFloat(row.laenge)]
      gp = new Parse.GeoPoint({ latitude, longitude })
    } catch (error) {
      // try to get geopoint from address
      const input = str.indexOf(' / ') !== -1
        ? [str.replace(' / ', ' & '), ort].join(' ')
        : `${str} ${plz || ort}`
      const predictions = await getPlacesPredictions(input)
      if (!predictions.length) {
        return skipCubeImport({ cubeId: objectId, lc, date, i, e: 'No predictions', input })
      }
      try {
        const place = await getPlaceById(predictions[0].place_id)
        const { lat: latitude, lng: longitude } = place.geometry.location
        gp = new Parse.GeoPoint({ latitude, longitude })
      } catch (error) {
        return skipCubeImport({ cubeId: objectId, lc, date, i, e: 'Place ID not found', input, place_id: predictions[0].place_id })
      }
    }

    const MBfD = importData.ausbautreiber?.startsWith('MBfD') ? true : undefined

    const existingCube = await $query('Cube').equalTo('objectId', objectId).first({ useMasterKey: true })
    if (!existingCube) {
      try {
        await seedCube({
          objectId,
          lc,
          hti,
          ht,
          str,
          hsnr,
          plz,
          ort,
          state,
          gp,
          importData,
          MBfD
        }, false)
      } catch (error) {
        if (error.data?.code === 137) {
          consola.warn(`${objectId} exists`)
          return false
        }
        const e = error.data?.message || error.message
        // There is no error message, then what is the error ???
        if (!e) { throw new Error(error) }
        return skipCubeImport({ cubeId: objectId, lc, date, i, e })
      }
      return objectId
    }
    existingCube.id = encodeURIComponent(existingCube.id)
    // update the geopoint and import data in any case
    existingCube.set({ importData, hti, gp })
    //  set MBfD if true
    MBfD ? existingCube.set({ MBfD }) : existingCube.unset('MBfD')
    if (existingCube.get('vAt')) {
      await existingCube.save(null, { useMasterKey: true })
      return objectId + ' verified update'
    }
    existingCube.set({ str, hsnr, plz, ort, state })
    // update the ht if defined
    ht && existingCube.set({ ht })
    await existingCube.save(null, { useMasterKey: true })
    return objectId + ' unverified update'
  }
}

const operations = {}
const last10Updates = new Array(10).fill('-')
const seed = async function (seedRow, from, to) {
  const key = [from, to].join('-')
  const count = to - from
  const allImportedRows = await getAllImportedRows(lc, date, from, to)
  for (let i = from; i < to; i++) {
    if (allImportedRows.includes(i)) { continue }
    const objectId = await seedRow(i)
    const updateMessage = `${i}: ${objectId || 'Skipped'}`
    last10Updates.unshift(updateMessage)
    last10Updates.length > 10 && last10Updates.pop()
    operations[key] = `${i} (${parseInt(100 * (i - from) / count)}%)`
  }
  operations[key] = true
}

async function start () {
  const seedRow = await generateSeedRowFn()
  const { count } = await axios({ url: 'http://localhost:5001/count' }).then(res => res.data)
  let from = 0
  let to = 25000
  while (from < count) {
    operations[`${from}-${to}`] = null
    seed(seedRow, from, to)
    from = to
    to += 25000
    to > count && (to = count)
  }
  import('log-update').then(({ default: logUpdate }) => {
    const interval = setInterval(() => {
      const runningOperations = Object.keys(operations)
        .filter(key => operations[key] && operations[key] !== true)
        .map(key => `${key}: ${operations[key]}`)
      if (Object.keys(operations).every(key => operations[key] === true)) {
        consola.success('DONE')
        clearInterval(interval)
        return
      }
      logUpdate(`
LAST 10 UPDATES:
${last10Updates.join('\n')}
----
RUNNING OPERATIONS:
${runningOperations.join('\n')}
`)
    }, 1000)
  })
}
start()

// async function checkNotUpdated() {
//   let found = 0
//   let notFound = 0
//   const skippedCubeIds = await $query('SkippedCubeImport').distinct('cubeId', { useMasterKey: true })
//   const nonUpdatedCubes = await $query('Cube')
//     .equalTo('lc', lc)
//     .notContainedIn('objectId', skippedCubeIds)
//     .notEqualTo('importData.date', date)
//     .distinct('objectId', { useMasterKey: true })
//   for (objectId of nonUpdatedCubes) {
//     if (!(/^[A-Za-z0-9ÄÖÜäöüß*_/()-]+$/).test(objectId)) {
//       consola.error('Should delete', objectId)
//       continue
//     }
//     const row = await axios({ url: 'http://localhost:5001/objectId/' + encodeURIComponent(objectId) })
//       .then(res => res.data)
//       .catch(error => error.response.data)
//     if (!row.error) {
//       found++
//       consola.warn(objectId, row)
//       continue
//     }
//     notFound++
//   }
//   consola.warn('found', found)
//   consola.warn('notFound', notFound)
//   return
// }

// checkNotUpdated()
