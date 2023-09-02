require('dotenv').config()
global.Parse = require('parse/node')
require('./../src/globals')
global.DEVELOPMENT = process.argv[2] !== '--prod'

module.exports = async (func) => {
  Parse.serverURL = DEVELOPMENT ? process.env.PUBLIC_SERVER_URL : process.env.PRODUCTION_SERVER_URL
  Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
  async function runAndExit () {
    consola.info(`Running ${func.name} on ${Parse.serverURL}`)
    try {
      await func()
      process.exit()
    } catch (e) {
      console.log(e)
      process.exit()
    }
  }
  function ask () {
    return new Promise((resolve) => {
      process.stdin.once('data', function (data) {
        if (data.toString().trim() === 'y') {
          return runAndExit()
        }
        if (data.toString().trim() === 'n') {
          return process.exit()
        }
        return ask()
      })
      process.stdout.write('The process will run on the production server. OK? (y/n)')
    })
  }
  return DEVELOPMENT ? runAndExit() : ask()
}
