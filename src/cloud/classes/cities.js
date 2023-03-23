// global.$states = {
//   NI: 'Niedersachsen',
//   BW: 'Baden-Württemberg',
//   SH: 'Schleswig-Holstein',
//   BY: 'Bayern',
//   SL: 'Saarland',
//   HB: 'Bremen',
//   MV: 'Mecklenburg-Vorpommern',
//   HE: 'Hessen',
//   TH: 'Thüringen',
//   RP: 'Rheinland-Pfalz',
//   ST: 'Sachsen-Anhalt',
//   HH: 'Hamburg',
//   NW: 'Nordrhein-Westfalen',
//   SN: 'Sachsen',
//   BB: 'Brandenburg',
//   BE: 'Berlin'
// }

// TEMPORARY SOLUTION FOR CITIES AND STATES
Parse.Cloud.beforeSave('City', async ({ object: city }) => {
  // ort and state are required
  if (!city.get('ort') || !city.get('state')) {
    throw new Error('ort and state are required')
  }
  if (!city.get('gp')) {
    const [{ longitude, latitude }] = await $query('Cube').aggregate([
      { $match: { ort: city.get('ort'), _p_state: 'State$' + city.get('state').id } },
      {
        $group: {
          _id: null,
          longitude: { $avg: { $arrayElemAt: ['$gp', 0] } },
          latitude: { $avg: { $arrayElemAt: ['$gp', 1] } }
        }
      }
    ])
    city.set('gp', $geopoint(latitude, longitude))
  }
})

Parse.Cloud.afterFind('City', ({ objects: cities }) => {
  for (const city of cities) {
    // TODO: Remove (open issue -> js sdk does not encodeURI so some chars in ID throw errors, whereas rest api works)
    city.id = decodeURIComponent(city.id)
  }
})

// async function uploadCities() {
//   await $query('City').eachBatch(async (cities) => {
//     const requests = cities.map(city => ({
//       method: 'POST',
//       path: '/parse/classes/City/',
//       body: {
//         objectId: city.id,
//         ort: city.get('ort'),
//         state: city.get('state').toPointer(),
//         gp: city.get('gp').toJSON()
//       }
//     }))
//     await Parse.Cloud.httpRequest({
//       method: 'POST',
//       url: `${process.env.PRODUCTION_SERVER_URL}/batch`,
//       headers: {
//         'Content-Type': 'application/json;charset=utf-8',
//         'X-Parse-Application-Id': process.env.APP_ID,
//         'X-Parse-Master-Key': process.env.MASTER_KEY
//       },
//       body: { requests }
//     }).catch(err => consola.error(err.text))
//     consola.info('Uploaded', cities.length, 'cities')
//   }, { useMasterKey: true })
// }
// uploadCities()
