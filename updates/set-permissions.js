require('dotenv').config()
global.Parse = require('parse/node')
// Parse.serverURL = process.env.PRODUCTION_SERVER_URL
Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

// set manage-fieldwork permissions
const manageFieldwork = [
  'rwe@rheinkultur-medien.de',
  'denizar@gmail.com',
  'sth@rheinkultur-medien.de',
  'giwe@rheinkultur-medien.de'
]
$query(Parse.User)
  .containedIn('username', manageFieldwork)
  .notEqualTo('permissions', 'manage-fieldwork')
  .each((user) => {
    const permissions = user.get('permissions') || []
    permissions.push('manage-fieldwork')
    return user.set({ permissions }).save(null, { useMasterKey: true })
  }, { useMasterKey: true })
