// Description: Parse a CSV file and serve the data via an express server
const path = require('path')
const csv = require('csvtojson')
const convertGaussKruger = require('./convert')
const app = require('express')()

async function start () {
  const filename = process.argv[2] || 'import.csv'
  const csvFilePath = path.resolve(__dirname, 'data', filename)
  console.log(`starting up ${filename}`)
  console.log(`full path: ${csvFilePath}`)
  const data = await csv().fromFile(csvFilePath)

  const dict = {}
  for (const row of data) {
    const objectId = 'TLK-' + row.kvz_id
    dict[objectId] = row
  }

  app.get('/count', async (req, res) => {
    return res.send({ count: data.length })
  })

  app.get('/ids', async (req, res) => {
    return res.send(Object.keys(dict))
  })

  app.get('/index/:index', async (req, res) => {
    const row = data[req.params.index]
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
    if (row.bundesland) {
      row.bundesland = row.bundesland.replace(/Ã¼/g, 'ü')
    }
    row.i = data.indexOf(row)
    return res.send(row)
  })

  const httpServer = require('http').createServer(app)
  httpServer.listen(5001, function () {
    console.log('HTTP Server running on port 5001')
  })
}
start()
