require('dotenv').config()
global.Parse = require('parse/node')
require('./../src/globals')

module.exports = async (func) => {
  const isProduction = process.argv[2] === '--prod'
  function ask () {
    process.stdout.write('The process will run on the production server. Proceed? (y/n)?')
  }
  if (isProduction) {
    process.stdin.on('data', function (data) {
      if (data.toString().trim() === 'y') {
        Parse.serverURL = process.env.PRODUCTION_SERVER_URL
        Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
        return func()
      }
      if (data.toString().trim() === 'n') {
        return process.stdin.end()
      }
      return ask()
    })
    return ask()
  }
  // DEVELOPMENT
  Parse.serverURL = process.env.PUBLIC_SERVER_URL
  Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
  return func()
}
