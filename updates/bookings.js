require('dotenv').config()
global.Parse = require('parse/node')
// Parse.serverURL = process.env.PRODUCTION_SERVER_URL
Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

// SET ORDER KEYS
// $query('Cube')
//   .notEqualTo('order', null)
//   .equalTo('caok', null)
//   .eachBatch(async (cubes) => {
//     for (const cube of cubes) {
//       await $saveWithEncode(cube, null, { useMasterKey: true })
//       consola.info(cube.id)
//     }
//   }, { useMasterKey: true }).then(consola.success)

// SET BOOKING CUBES
// $query('Booking')
//   .eachBatch(async (bookings) => {
//     for (const booking of bookings) {
//       await booking.save(null, { useMasterKey: true })
//       consola.info(booking.id)
//     }
//   }, { useMasterKey: true }).then(consola.success)
