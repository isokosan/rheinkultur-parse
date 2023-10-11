const DOUBLES = [
  'B22-0881',
  'B23-0195',
  'B22-0697',
  'B22-1019',
  'B19-0416',
  'B19-0416',
  'B22-0854',
  'B23-0620',
  'B23-0516',
  'B23-0209',
  'B20-0186',
  'B20-0197',
  'B22-0583',
  'B20-0197',
  'B20-0186',
  'B23-0400',
  'B20-0547',
  'B20-0547',
  'B21-0122',
  'B21-0122',
  'B23-0645',
  'B23-0016',
  'B23-0663',
  'B22-0853',
  'B22-0362',
  'B22-0362',
  'B22-0583',
  'B22-0697',
  'B22-0945',
  'B23-0213',
  'B23-0221',
  'B22-0853',
  'B22-0854',
  'B22-0881',
  'B22-0945',
  'B22-1019',
  'B23-0016',
  'B23-0195',
  'B23-0237',
  'B23-0209',
  'B23-0213',
  'B23-0221',
  'B23-0237',
  'B23-0551',
  'B23-0400',
  'B23-0516',
  'B23-0551',
  'B23-0620',
  'B23-0645',
  'B23-0663'
]

require('./run')(async () => {
  // const fs = require('fs').promises
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

  let i = 0
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
      if (row.match && !DOUBLES.includes(row.match)) {
        const booking = await $query('Booking').equalTo('no', row.match).first({ useMasterKey: true })
        row.externalOrderNo = row.externalOrderNo.trim()
        if (booking && booking.get('externalOrderNo') !== row.externalOrderNo) {
          console.log(booking.get('no'), row.externalOrderNo)
          booking.set('externalOrderNo', row.externalOrderNo)
          await booking.save(null, { useMasterKey: true })
          i++
        }
      }
    }
    if (!row.match) {
      row.problem = cube ? 'Buchung nicht gefunden' : 'Cube nicht gefunden'
    }
    response.push(row)
  }
  console.log('DONE', i)
  // save response as werberaum.json
  // return fs.writeFile('./updates/werberaum.json', JSON.stringify(response))
})
