// Description: Parse a JSON file and serve the data via an express server
// First save an export as a comma separated csv, then convert to json via csvtojson

const express = require('express')
const app = express()
const convertGaussKruger = require('./convert')

const filename = process.argv[2]

console.log(`starting up ${filename}`)
const all = require('./imports/' + filename)

app.get('/count', async (req, res) => {
  return res.send({ count: all.length })
})

app.get('/index/:index', async (req, res) => {
  const row = all[req.params.index]
  if (!(row.breite && row.laenge) && (row.rechts && row.hoch)) {
    const { lat, lon } = convertGaussKruger(row.rechts, row.hoch)
    row.breite = lat
    row.laenge = lon
  }
  row.bundesland = row.bundesland.replace(/Ã¼/g, 'ü')
  return res.send(row)
})

const httpServer = require('http').createServer(app)
httpServer.listen(5001, function () {
  console.log('HTTP Server running on port 5001')
})
