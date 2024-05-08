require('dotenv').config()
const path = require('path')
const fs = require('fs')
const csv = require('csvtojson')
global.Parse = require('parse/node')
// const serverURL = process.env.PRODUCTION_SERVER_URL
const serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
Parse.serverURL = serverURL
require('./../src/globals')

const parseAsDigitString = function (num, digits = 4) {
  if (num === null || num === undefined) { return num }
  let string = `${num}`
  while (string.length < digits) {
    string = '0' + string
  }
  return string
}
async function start () {
  const filename = process.argv[2] || 'vodafone.csv'
  const csvFilePath = path.resolve(__dirname, 'data', filename)
  const data = await csv().fromFile(csvFilePath)
  let i = 1
  for (const row of data) {
    row.id = 'VOD-RMV' + parseAsDigitString(i)
    i++
    const nominatim = await Parse.Cloud.run('nominatim', { lat: row.latitude, lon: row.longitude }, { useMasterKey: true })
    row.node = row.node?.trim()
    row.str = nominatim.address.road
    row.hsnr = nominatim.address.house_number
    row.ort = nominatim.address.city
    row.plz = nominatim.address.postcode
    row.stateName = nominatim.address.state
    console.log(i)
  }
  // save data in json
  const jsonFilePath = path.resolve(__dirname, 'data', filename.replace('.csv', '.json'))
  fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2))
  console.log('Data saved in', jsonFilePath)
  // save as vodafone_fixed.csv
  const csvFilePathFixed = path.resolve(__dirname, 'data', filename.replace('.csv', '_fixed.csv'))
  const csvWriter = require('csv-writer').createObjectCsvWriter({
    path: csvFilePathFixed,
    header: [
      { id: 'CityCubeID', title: 'id' },
      { id: 'node', title: 'node' },
      { id: 'latitude', title: 'latitude' },
      { id: 'longitude', title: 'longitude' },
      { id: 'str', title: 'str' },
      { id: 'hsnr', title: 'hsnr' },
      { id: 'ort', title: 'ort' },
      { id: 'plz', title: 'plz' },
      { id: 'stateName', title: 'stateName' }
    ]
  })
  await csvWriter.writeRecords(data)
  console.log('Data saved in', csvFilePathFixed)
}
start()
