require('dotenv').config()
const path = require('path')
const axios = require('axios')
const csv = require('csvtojson')
const serverURL = process.env.PUBLIC_SERVER_URL
// const serverURL = process.env.PRODUCTION_SERVER_URL

global.Parse = require('parse/node')
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
Parse.serverURL = serverURL
require('./../src/globals')

const seedCube = async (body) => axios({
  method: 'POST',
  url: `${serverURL}/classes/Cube`,
  headers: {
    'Content-Type': 'application/json;charset=utf-8',
    'X-Parse-Application-Id': process.env.APP_ID,
    'X-Parse-Master-Key': process.env.MASTER_KEY
  },
  data: body
})
async function start () {
  const filename = process.argv[2] || 'vodafone_combined.csv'
  const csvFilePath = path.resolve(__dirname, 'data', filename)
  const data = await csv().fromFile(csvFilePath)
  const state = $pointer('State', 'NW')
  for (const cube of data) {
    const [latitude, longitude] = [parseFloat(cube.latitude), parseFloat(cube.longitude)]
    const gp = new Parse.GeoPoint({ latitude, longitude })
    cube.ID = 'VOD-RMV00' + cube.ID.slice(7)
    await seedCube({
      objectId: cube.ID,
      lc: 'VOD',
      gp,
      str: cube.str,
      hsnr: cube.hsnr,
      plz: cube.plz,
      ort: cube.ort,
      state
    }).catch(console.error).then(console.log)
  }
}
start()
