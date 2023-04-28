require('dotenv').config()
const axios = require('axios')
global.Parse = require('parse/node')
// Parse.serverURL = process.env.PRODUCTION_SERVER_URL
Parse.serverURL = process.env.PUBLIC_SERVER_URL
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
  getLastImportedRow,
  getAllImportedRows,
  seedCube
} = require('./../src/seed/cubes/utils')

const lc = 'TLK'
const date = '2023-04-21'

async function generateSeedRowFn () {
  const { plzs, states, hts } = await prepareDicts()
  return async function seedRow (i) {
    const row = await axios({ url: 'http://localhost:5001/index/' + i }).then(res => res.data)
    const objectId = await getCubeId(lc, date, i, row, 'kvz_id')
    if (!objectId) { return false }
    // if cube already updated, skip
    if (await $query('Cube').equalTo('objectId', objectId).equalTo('importData.date', date).count({ useMasterKey: true })) {
      consola.info('Cube already updated', objectId)
      return false
    }

    // if skipped import already exists, skip
    if (await $query('SkippedCubeImport').equalTo('cubeId', objectId).equalTo('date', date).count({ useMasterKey: true })) {
      consola.info('Import already skipped', objectId)
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
        consola.error(error.text)
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

const seed = async function () {
  const allImportedRows = await getAllImportedRows(lc, date)
  const { count } = await axios({ url: 'http://localhost:5001/count' }).then(res => res.data)
  consola.info(`seeding ${count - allImportedRows.length} remaining ${lc} from total ${count}`)
  const seedRow = await generateSeedRowFn()
  for (let i = await getLastImportedRow(lc, date); i < count; i++) {
    if (allImportedRows.includes(i)) { continue }
    const objectId = await seedRow(i)
    consola.success(i, `${objectId || 'Skipped'} import`)
  }
  consola.success('Seeded cubes')
}

seed()
