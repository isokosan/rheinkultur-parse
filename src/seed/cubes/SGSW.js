const { getPlacesPredictions, getPlaceById } = require('@/services/google-maps')

const {
  seedCube,
  cleanVal,
  prepareDicts,
  getCubeId,
  skipCubeImport,
  getAllImportedRows
} = require('./utils')

const lc = 'SGSW'
const date = undefined

const seed = async function () {
  const { plzs, states } = await prepareDicts()
  const all = require('@/../imports/SGSW_cubes.json')
  const allImportedRows = await getAllImportedRows(lc, date)
  consola.info('starting seeding')
  for (let i = 0; i < all.length; i++) {
    if (allImportedRows.includes(i)) {
      continue
    }
    const row = all[i]
    const objectId = await getCubeId(lc, date, i, row, 'ID-Nr.')
    if (!objectId) {
      continue
    }
    const importData = {
      address: cleanVal(row.Strasse),
      kvTyp: cleanVal(row['KV-Typ']),
      schrankNr: cleanVal(row['Schrank-Nr.']),
      art: cleanVal(row.Art),
      date
    }
    let str = importData.address
    let hsnr = cleanVal(row['H.-Nr.'])
    let plz = cleanVal(row.PLZ)
    const ort = 'Solingen'

    const input = `${str}, ${plz || ort}`
    const predictions = await getPlacesPredictions(input)
    if (!predictions.length) {
      await skipCubeImport({ cubeId: objectId, lc, date, i, e: 'No predictions', input })
      continue
    }
    const place = await getPlaceById(predictions[0].place_id)
    const { lat: latitude, lng: longitude } = place.geometry.location
    const gp = new Parse.GeoPoint({ latitude, longitude })
    const addressComponents = place.address_components.reduce((acc, cur) => {
      acc[cur.types[0]] = cur.long_name
      return acc
    }, {})
    const { street_number, route, intersection, locality, postal_code } = addressComponents
    if (!street_number && !route && !intersection) {
      consola.error({ objectId, input, ort, plz, addressComponents })
      await skipCubeImport({ cubeId: objectId, lc, date, i, e: 'No place match', input })
      continue
    }
    if (street_number) {
      hsnr = street_number
    }
    if (route) {
      str = route
    }
    if (intersection) {
      str = intersection
      hsnr = street_number
    }
    if (plz && postal_code !== plz) {
      consola.error({ objectId, input, ort, plz, addressComponents })
      await skipCubeImport({ cubeId: objectId, lc, date, i, e: 'No place match', input })
      continue
    }
    if (!plz && postal_code) {
      plz = postal_code
    }
    if (locality !== 'Solingen') {
      consola.error({ objectId, input, ort, plz, addressComponents })
      await skipCubeImport({ cubeId: objectId, lc, date, i, e: 'No place match', input })
      continue
    }

    const { ort: plzsOrt, bundesland } = plzs[plz] || {}
    if (!plz || !ort || !bundesland) {
      consola.error({ i, plz, ort, bundesland })
      await skipCubeImport({ cubeId: objectId, lc, date, i, e: 'Missing or bad PLZ', input, plz })
      continue
    }
    const state = states[bundesland]

    if (plzsOrt !== ort) {
      consola.error({ objectId, input, ort, plzsOrt, addressComponents })
      await skipCubeImport({ cubeId: objectId, lc, date, i, e: 'Out of solingen', input, plzsOrt })
      continue
    }

    try {
      await seedCube({
        i,
        objectId,
        lc,
        str,
        hsnr,
        plz,
        ort,
        state,
        gp,
        importData
      })
      consola.success(i, `${objectId} imported`, { address: importData.address, str, hsnr })
    } catch (error) {
      if (error.data?.code === 137) {
        consola.warn(`${objectId} exists`)
        continue
      } else {
        await skipCubeImport({ cubeId: objectId, lc, date, i, e: error.data?.message || error.message })
      }
    }
  }
  consola.success('Seeded cubes')
}

module.exports = {
  seed
}
