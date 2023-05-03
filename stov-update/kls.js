require('dotenv').config()
const axios = require('axios')
global.Parse = require('parse/node')
Parse.serverURL = process.env.PRODUCTION_SERVER_URL
// Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

const {
  cleanVal,
  getAllImportedRows
} = require('./../src/seed/cubes/utils')

const lc = 'TLK'
const date = '2023-05-04'

async function generateSeedRowFn () {
  return async function seedRow (i) {
    const row = await axios({ url: 'http://localhost:5001/index/' + i }).then(res => res.data)
    const kvzId = cleanVal(row.KVZ_ID)
    const klsId = cleanVal(row.KLS_ID)
    const str = cleanVal(row.Strasse)
    const hsnr = cleanVal(row.HS_NR)
    let gp
    try {
      const [latitude, longitude] = [parseFloat(row.breite), parseFloat(row.laenge)]
      gp = new Parse.GeoPoint({ latitude, longitude })
    } catch (error) {
      console.error('Error parsing geo point')
    }
    let cubeCount = 0
    await Parse.Query.or(
      $query('Cube').equalTo('importData.klsId', klsId),
      $query('Cube').equalTo('objectId', 'TLK-' + kvzId)
    )
      .notEqualTo('importData.date', date)
      .each(async (cube) => {
        const importData = cube.get('importData')
        importData.i = i
        importData.date = date
        cube.set('importData', importData)
        gp && cube.set('gp', gp)
        !cube.get('vAt') && cube.set({ str, hsnr })
        cube.id = encodeURIComponent(cube.id)
        // eslint-disable-next-line rk-lint/cube-must-encode
        await cube.save(null, { useMasterKey: true })
        cubeCount++
      }, { useMasterKey: true })
    return `${klsId} - ${cubeCount} cubes updated`
  }
}

const operations = {}
const last10Updates = new Array(10).fill('-')
const seed = async function (seedRow, from, to) {
  const key = [from, to].join('-')
  const count = to - from
  const allImportedRows = await getAllImportedRows(lc, date, from, to)
  for (let i = from; i < to; i++) {
    if (allImportedRows.includes(i)) { continue }
    const objectId = await seedRow(i)
    const updateMessage = `${i}: ${objectId || 'Skipped'}`
    last10Updates.unshift(updateMessage)
    last10Updates.length > 10 && last10Updates.pop()
    operations[key] = `${i} (${parseInt(100 * (i - from) / count)}%)`
  }
  operations[key] = true
}

async function start () {
  const seedRow = await generateSeedRowFn()
  const { count } = await axios({ url: 'http://localhost:5001/count' }).then(res => res.data)
  let from = 0
  let to = 25000
  while (from < count) {
    operations[`${from}-${to}`] = null
    seed(seedRow, from, to)
    from = to
    to += 25000
    to > count && (to = count)
  }
  import('log-update').then(({ default: logUpdate }) => {
    const interval = setInterval(() => {
      const runningOperations = Object.keys(operations)
        .filter(key => operations[key] && operations[key] !== true)
        .map(key => `${key}: ${operations[key]}`)
      if (Object.keys(operations).every(key => operations[key] === true)) {
        consola.success('DONE')
        clearInterval(interval)
        return
      }
      logUpdate(`
LAST 10 UPDATES:
${last10Updates.join('\n')}
----
RUNNING OPERATIONS:
${runningOperations.join('\n')}
`)
    }, 1000)
  })
}
start()
