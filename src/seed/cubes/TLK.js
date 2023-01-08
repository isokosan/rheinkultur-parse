const { getPlacesPredictions, getPlaceById } = require('@/services/google-maps')
const { parseAsDigitString } = require('@/utils')

const {
  seedCube,
  cleanVal,
  prepareDicts,
  getCubeId,
  skipCubeImport,
  getLastImportedRow,
  getAllImportedRows
} = require('./utils')

const lc = 'TLK'
const date = '2022-06-03'

async function generateSeedRowFn () {
  const { plzs, states, hts } = await prepareDicts()
  return async function seedRow (i) {
    const row = await Parse.Cloud.httpRequest({ url: 'http://localhost:5001/index/' + i }).then(res => res.data)
    const objectId = await getCubeId(lc, date, i, row, 'KVZ_ID')
    if (!objectId) { return false }

    // if cube already exists, skip
    if (await $query('Cube').equalTo('objectId', objectId).count()) {
      return false
    }
    // if skipped import already exists, skip
    if (await $query('SkippedCubeImport').equalTo('cubeId', objectId).equalTo('date', date).count()) {
      return false
    }

    const importData = {
      kvzId: cleanVal(row.KVZ_ID),
      klsId: cleanVal(row.KLS_ID),
      date
    }

    let ht
    const hti = cleanVal(row.KVzGehaeuseTyp)
    if (hti && hti in hts) {
      ht = $pointer('HousingType', hts[hti].id)
    }

    const str = cleanVal(row.Strasse)
    const hsnr = cleanVal(row.HS_NR)
    const plz = parseAsDigitString(cleanVal(row.PLZ), 5)
    const ort = cleanVal(row.ORT)
    let state = cleanVal(row.Bundesland)

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

    try {
      await seedCube({
        i,
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
        MBfD: row.ausbautreiber1 === 'MBfD' ? true : undefined
      })
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
}

const seed = async function () {
  const allImportedRows = await getAllImportedRows(lc, date)
  const { count } = await Parse.Cloud.httpRequest({ url: 'http://localhost:5001/count' }).then(res => res.data)
  consola.info(`seeding ${count - allImportedRows.length} remaining ${lc} from total ${count}`)
  const last100Times = Array.from({ length: 100 }, x => 0)
  const seedRow = await generateSeedRowFn()
  for (let i = await getLastImportedRow(lc, date); i < count; i++) {
    const timeStart = (new Date()).getTime()
    if (allImportedRows.includes(i)) { continue }
    const objectId = await seedRow(i)
    const timeDiff = (new Date()).getTime() - timeStart
    last100Times.shift()
    last100Times.push(timeDiff)
    const averageTime = last100Times.reduce((p, c) => p + c, 0) / last100Times.length
    if (averageTime > 20) {
      consola.warn('Stopping average exceeded 20ms')
      require('fs').utimesSync(__filename, Date.now(), Date.now())
      return
    }
    consola.success(i, `${objectId || 'Skipped'} import in ${timeDiff}, ${averageTime}`)
  }
  consola.success('Seeded cubes')
}

module.exports = {
  seed
}
