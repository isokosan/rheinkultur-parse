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
  const data = await csv().fromFile(path.resolve(__dirname, 'data', 'vod_dusseldorf.csv'))
  const processed = await csv().fromFile(path.resolve(__dirname, 'data', 'vodafone_combined.csv'))
  let i = 0
  for (const row of data) {
    i++
    console.log(i)
    row.id = 'VOD-RMV' + parseAsDigitString(i)
    // try to find the same latitude and longitude in processed
    const found = processed.find(p => p.latitude === row.latitude && p.longitude === row.longitude)
    if (found) {
      // console.log('Found in processed', found)
      row.node = found.node
      row.str = found.str
      row.hsnr = found.hsnr
      row.ort = found.ort
      row.plz = found.plz
      row.stateName = found.stateName
      continue
    }
    console.log('Not found in processed')
    // get nominatim data
    try {
      const nominatim = await Parse.Cloud.run('nominatim', { lat: row.latitude, lon: row.longitude }, { useMasterKey: true })
      row.node = row.node?.trim()
      row.str = nominatim.address.road
      row.hsnr = nominatim.address.house_number
      row.ort = nominatim.address.city
      row.plz = nominatim.address.postcode
      row.stateName = nominatim.address.state
    } catch (error) {
      console.error('Error in nominatim', error)
    }
  }
  // save data in json
  const jsonFilePath = path.resolve(__dirname, 'data', 'vod_dusseldorf_with-address.json')
  fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2))
  console.log('Data saved in', jsonFilePath)
  // save as vodafone_fixed.csv
  const csvWriter = require('csv-writer').createObjectCsvWriter({
    path: path.resolve(__dirname, 'data', 'vod_dusseldorf_with-address.csv'),
    header: [
      { id: 'node', title: 'node' },
      { id: 'plz', title: 'plz' },
      { id: 'ort', title: 'ort' },
      { id: 'stadtteil', title: 'stadtteil' },
      { id: 'str hsnr', title: 'str hsnr' },
      { id: 'plz', title: 'plz' },
      { id: 'address', title: 'address' },
      { id: 'latitude', title: 'latitude' },
      { id: 'longitude', title: 'longitude' },
      { id: 'CityCubeID', title: 'id' },
      { id: 'str', title: 'str' },
      { id: 'hsnr', title: 'hsnr' },
      { id: 'ort', title: 'ort' },
      { id: 'plz', title: 'plz' },
      { id: 'stateName', title: 'stateName' }
    ]
  })
  await csvWriter.writeRecords(data)
  console.log('Data saved')
}
start()
