// require('dotenv').config()
// global.Parse = require('parse/node')
// Parse.serverURL = process.env.PRODUCTION_SERVER_URL
// // Parse.serverURL = process.env.PUBLIC_SERVER_URL
// console.log(Parse.serverURL)
// Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
// require('./../src/globals')

// async function setPermissions () {
//   let i = 0
//   const viewAudits = [
//     'jso@rheinkultur-medien.de',
//     'sth@rheinkultur-medien.de'
//   ]
//   await Parse.Query.or(
//     $query(Parse.User).containedIn('username', viewAudits),
//     $query(Parse.User).equalTo('accType', 'admin')
//   )
//     .notEqualTo('permissions', 'view-audits')
//     .each((user) => {
//       const permissions = user.get('permissions') || []
//       permissions.push('view-audits')
//       i++
//       return user.set({ permissions }).save(null, { useMasterKey: true })
//     }, { useMasterKey: true })
//   return i
// }

// setPermissions().then(consola.success)
