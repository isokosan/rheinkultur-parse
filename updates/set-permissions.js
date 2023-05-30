require('dotenv').config()
global.Parse = require('parse/node')
// Parse.serverURL = process.env.PRODUCTION_SERVER_URL
Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

async function setPermissions () {
  const permission = 'manage-bookings'
  const emails = [
    'denizar@gmail.com',
    'gwe@rheinkultur-medien.de',
    'rwe@rheinkultur-medien.de',
    'adv@rheinkultur-medien.de'
  ]
  const query = $query(Parse.User).containedIn('username', emails)
  let i = 0
  await query
    .notEqualTo('permissions', permission)
    .each((user) => {
      const permissions = user.get('permissions') || []
      permissions.push(permission)
      i++
      return user.set({ permissions }).save(null, { useMasterKey: true, context: { clearSessions: true } })
    }, { useMasterKey: true })
  return i
}

setPermissions().then(consola.success)
