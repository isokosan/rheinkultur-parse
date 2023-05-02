require('dotenv').config()
const axios = require('axios')
global.Parse = require('parse/node')
Parse.serverURL = process.env.PRODUCTION_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')
const { difference } = require('lodash')

const lc = 'TLK'
const date = '2022-04-24'

async function getAllIds () {
  return axios({
    url: process.env.PUBLIC_SERVER_URL + '/aggregate/Cube/',
    method: 'GET',
    params: {
      where: JSON.stringify({
        lc: 'TLK'
      }),
      distinct: 'objectId'
    },
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Master-Key': process.env.MASTER_KEY
    }
  }).then(res => res.data.results)
}

function findCube (objectId) {
  return axios({
    url: process.env.PUBLIC_SERVER_URL + '/classes/Cube/',
    method: 'GET',
    params: {
      where: JSON.stringify({
        objectId
      }),
      limit: 1
    },
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Master-Key': process.env.MASTER_KEY
    }
  }).then(res => res.data.results[0])
}

async function updateCube (id) {
  const source = await findCube(id)
  if (!source) {
    throw new Error('Cannot find local cube', id)
  }
  try {
    const cube = await $getOrFail('Cube', id)
    const { gp, ht, hti, str, hsnr, ort, plz, state, importData, MBfD } = source
    cube.set({ gp, importData: { ...importData, date } })
    MBfD ? cube.set({ MBfD }) : cube.unset('MBfD')
    !cube.get('vAt') && cube.set({ ht, hti, str, hsnr, ort, plz, state })
    cube.id = encodeURIComponent(cube.id)
    // eslint-disable-next-line rk-lint/cube-no-save
    await cube.save(null, { useMasterKey: true })
    return id
  } catch (error) {

  }
}

const operations = {}
const last10Updates = new Array(10).fill('-')

const update = async function (opIndex, ids) {
  consola.info(opIndex, ids.length)
  const count = ids.length
  let i = 0
  for (const id of ids) {
    const objectId = await updateCube(id)
    const updateMessage = `op${opIndex}: ${objectId || 'Skipped'}`
    last10Updates.unshift(updateMessage)
    last10Updates.length > 10 && last10Updates.pop()
    i++
    operations[opIndex] = `(${parseInt(100 * i / count)}%)`
  }
  operations[opIndex] = true
}

async function getRemainingIds () {
  const [allIds, allUpdatedIds] = await Promise.all([
    getAllIds(),
    $query('Cube')
      .equalTo('lc', lc)
      .equalTo('importData.date', date)
      .distinct('objectId', { useMasterKey: true })
  ])
  return difference(allIds, allUpdatedIds)
}

async function start () {
  const remainingIds = await getRemainingIds()
  consola.info(remainingIds.length)
  const chunkSize = 25000
  for (let i = 0; i < remainingIds.length; i += chunkSize) {
    operations[i] = null
    update(i, remainingIds.slice(i, i + chunkSize))
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
