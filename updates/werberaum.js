require('./run')(async () => {
  const fs = require('fs').promises
  const csv = require('csvtojson')
  const csvFilePath = require('path').resolve(__dirname, 'werberaum.csv')
  const all = await csv({ trim: true }).fromFile(csvFilePath)
    .then(rows => rows.map((row) => {
      row.objectId = 'TLK-' + row.kvzId
      return row
    }))
  const cubes = await $query('Cube')
    .containedIn('objectId', all.map(r => r.objectId))
    .limit(all.length)
    .select('objectId', 'order', 'futureOrder')
    .find({ useMasterKey: true })

  const response = []
  for (const row of all) {
    const cube = cubes.find(cube => cube.id === row.objectId)
    if (cube) {
      // const order = cube.get('order') || cube.get('futureOrder')
      // order && console.log(order)
      const order = cube.get('order')?.company?.id === 'XPLYKFS9Pc'
        ? cube.get('order')
        : cube.get('futureOrder')?.company?.id === 'XPLYKFS9Pc'
          ? cube.get('futureOrder')
          : undefined
      row.match = order?.no
    }
    if (!row.match) {
      row.problem = cube ? 'Buchung nicht gefunden' : 'Cube nicht gefunden'
    }
    response.push(row)
  }
  // save response as werberaum.json
  return fs.writeFile('./updates/werberaum.json', JSON.stringify(response))
})