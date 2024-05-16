require('dotenv').config()
const path = require('path')
async function start () {
  const json = require('./data/vod_dusseldorf_with-address.json')
  const csvWriter = require('csv-writer').createObjectCsvWriter({
    path: path.resolve(__dirname, 'data', 'vod_dusseldorf_with-address.csv'),
    header: [
      { id: 'id', title: 'id' },
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
  await csvWriter.writeRecords(json)
  console.log('Data saved')
}
start()
