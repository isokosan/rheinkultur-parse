require('dotenv').config()
global.Parse = require('parse/node')
Parse.serverURL = process.env.PRODUCTION_SERVER_URL
// Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

$query('Cube').contains('str', 'KVZ').distinct('str', { useMasterKey: true }).then(res => {
  const fs = require('fs').promises
  // write to file as json
  return fs.writeFile('kvz_str.json', JSON.stringify(res), 'utf8')
})
