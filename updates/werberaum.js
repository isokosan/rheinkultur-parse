require('./run')(async () => {
  const csv = require('csvtojson')
  const csvFilePath = require('path').resolve(__dirname, 'werberaum.csv')
  const all = await csv({ trim: true }).fromFile(csvFilePath)
    .then(rows => rows.map((row) => {
      row.objectId = 'TLK-' + row.kvzId
      return row
    }))
  console.log(all)
})