require('dotenv').config()
global.Parse = require('parse/node')
// Parse.serverURL = process.env.PRODUCTION_SERVER_URL
Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

$getOrFail('Company', 'XPLYKFS9Pc').then(async (company) => {
  const activeCubeOrderQuery = $query('Cube').equalTo('order.company', company)
  const activeBookingQuery = $query('Booking').equalTo('company', company).equalTo('status', 3)
  const cubeOrderCount = await activeCubeOrderQuery.count({ useMasterKey: true })
  const bookingCount = await activeBookingQuery.count({ useMasterKey: true })
  consola.info({ comp: company.get('name'), cubeOrderCount, bookingCount })
  const probs = await activeBookingQuery.doesNotMatchQuery('cube', activeCubeOrderQuery).find({ useMasterKey: true })
  consola.warn(probs.map(booking => booking.attributes))
})
