// const { getPlacesPredictions, getPlaceById } = require('@/services/google-maps')

// async function cubeLocations() {
//   const locations = {}
//   const cubes = await $query('Cube')
//     .select(['ort', 'state', 'gp'])
//     .eachBatch((cubes) => {
//       for (const cube of cubes) {
//         const { ort, state, gp } = cube.attributes
//         const location = [ort, state.id].join(':')
//         locations[location] = gp
//       }
//     }, { useMasterKey: true, batchSize: 100000 })
//   return locations
// }

// async function getGeopointFromPlace (input) {
//   const predictions = await getPlacesPredictions(input)
//   if (!predictions.length) {
//     return
//   }
//   let place
//   try {
//     place = await getPlaceById(predictions[0].place_id)
//   } catch (error) {
//     consola.error(error)
//     return
//   }
//   const { lat: latitude, lng: longitude } = place.geometry.location
//   return new Parse.GeoPoint({ latitude, longitude })
// }

Parse.Cloud.afterFind('City', ({ objects: cities }) => {
  for (const city of cities) {
    // TODO: Remove (open issue -> js sdk does not encodeURI so some chars in ID throw errors, whereas rest api works)
    city.id = encodeURI(city.id)
  }
})

// const createCity = async (body) => Parse.Cloud.httpRequest({
//   method: 'POST',
//   url: `${process.env.PUBLIC_SERVER_URL}/classes/City`,
//   headers: {
//     'Content-Type': 'application/json;charset=utf-8',
//     'X-Parse-Application-Id': process.env.APP_ID,
//     'X-Parse-Master-Key': process.env.MASTER_KEY
//   },
//   body
// })

// async function saveLocations() {
//   const locations = await cubeLocations()
//   const count = Object.keys(locations).length
//   let i = 0
//   for (const location of Object.keys(locations)) {
//     const objectId = location
//     const [ort, stateId] = location.split(':')
//     if (ort.trim() !== ort) {
//       throw new Error(location)
//     }
//     const state = $pointer('State', stateId)
//     const gp = locations[location]
//     await createCity({
//       objectId,
//       ort,
//       state,
//       gp
//     }).catch(() => {})
//     i++
//     consola.info(`${parseInt(100 * i / count)}%`)
//   }
//   await $query('City').equalTo('gp', null).each(async(city) => {
//     const ort = city.get('ort')
//     const state = city.get('state')
//     const cube = await $query('Cube')
//       .equalTo('ort', ort)
//       .equalTo('state', state)
//       .first({ useMasterKey: true })
//     city.set('gp', cube.get('gp'))
//     consola.warn('resaving gp')
//     return city.save(null, { useMasterKey: true })
//   }, { useMasterKey: true })
// }
// saveLocations()
