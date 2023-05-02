// Description: Parse a JSON file and serve the data via an express server
// First save an export as a comma separated csv, then convert to json via csvtojson

const express = require('express')
const app = express()
const convertGaussKruger = require('./convert')

const filename = process.argv[2]

console.log(`starting up ${filename}`)
const all = require('./imports/' + filename)
const dict = {}
for (const row of all) {
  const objectId = 'TLK-' + row.kvz_id
  dict[objectId] = row
}

app.get('/count', async (req, res) => {
  return res.send({ count: all.length })
})

app.get('/ids', async (req, res) => {
  return res.send(Object.keys(dict))
})

app.get('/index/:index', async (req, res) => {
  const row = all[req.params.index]
  if (!row) {
    return res.status(404).send({ error: 'not found' })
  }
  if (!(row.breite && row.laenge) && (row.rechts && row.hoch)) {
    const { lat, lon } = convertGaussKruger(row.rechts, row.hoch)
    row.breite = lat
    row.laenge = lon
  }
  if (row.bundesland) {
    row.bundesland = row.bundesland.replace(/Ã¼/g, 'ü')
  }
  return res.send(row)
})

app.get('/objectId/:objectId', async (req, res) => {
  const row = dict[req.params.objectId]
  if (!row) {
    return res.status(404).send({ error: 'not found' })
  }
  if (!(row.breite && row.laenge) && (row.rechts && row.hoch)) {
    const { lat, lon } = convertGaussKruger(row.rechts, row.hoch)
    row.breite = lat
    row.laenge = lon
  }
  row.bundesland = row.bundesland.replace(/Ã¼/g, 'ü')
  row.i = all.indexOf(row)
  return res.send(row)
})

const httpServer = require('http').createServer(app)
httpServer.listen(5001, function () {
  console.log('HTTP Server running on port 5001')
})
