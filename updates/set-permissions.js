require('dotenv').config()
global.Parse = require('parse/node')
// Parse.serverURL = process.env.PRODUCTION_SERVER_URL
Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

async function setPermissions () {
  let i = 0
  const manageFieldwork = [
    'rwe@rheinkultur-medien.de',
    'denizar@gmail.com',
    'sth@rheinkultur-medien.de',
    'giwe@rheinkultur-medien.de'
  ]
  await $query(Parse.User)
    .containedIn('username', manageFieldwork)
    .notEqualTo('permissions', 'manage-fieldwork')
    .each((user) => {
      const permissions = user.get('permissions') || []
      permissions.push('manage-fieldwork')
      i++
      return user.set({ permissions }).save(null, { useMasterKey: true })
    }, { useMasterKey: true })

  const manageScouts = [
    'rwe@rheinkultur-medien.de',
    'sth@rheinkultur-medien.de',
    'marc@asriel.de'
  ]
  await $query(Parse.User)
    .containedIn('username', manageScouts)
    .notEqualTo('permissions', 'manage-scouts')
    .each((user) => {
      const permissions = user.get('permissions') || []
      permissions.push('manage-scouts')
      i++
      return user.set({ permissions }).save(null, { useMasterKey: true })
    }, { useMasterKey: true })

  const manageBookings = [
    'marc@asriel.de'
  ]
  await $query(Parse.User)
    .containedIn('username', manageBookings)
    .notEqualTo('permissions', 'manage-bookings')
    .each((user) => {
      const permissions = user.get('permissions') || []
      permissions.push('manage-bookings')
      i++
      return user.set({ permissions }).save(null, { useMasterKey: true })
    }, { useMasterKey: true })
  return i
}

setPermissions().then(consola.success)
