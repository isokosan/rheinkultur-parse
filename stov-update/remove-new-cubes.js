require('dotenv').config()
global.Parse = require('parse/node')
Parse.serverURL = process.env.PRODUCTION_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

const lc = 'TLK'
const date = '2022-04-24'

async function start () {
  await $query('Cube')
    .equalTo('lc', lc)
    .notEqualTo('importData.date', date)
    .notEqualTo('importData.i', null)
    .equalTo('order', null)
    .equalTo('vAt', null)
    // .each(async cube => {
    //   console.log(cube.id)
    //   cube.id = encodeURIComponent(cube.id)
    //   // eslint-disable-next-line rk-lint/cube-must-encode
    //   await cube.destroy({ useMasterKey: true })
    // }, { useMasterKey: true })
    .count({ useMasterKey: true })
    .then(consola.info)
}
start()
