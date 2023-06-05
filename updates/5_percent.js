// const { round } = require('lodash')
// async function calculate5Percent () {
//   const q1 = await $query('QuarterlyReport')
//     .equalTo('quarter', '1-2023')
//     .include('rows')
//     .first({ useMasterKey: true })
//   const rows = q1.get('rows')
//   let total5 = 0
//   for (const row of rows) {
//     if (row.lessorRate === 25) {
//       row.lessor5 = round(row.lessorTotal / 5, 2)
//       total5 = round(total5 + row.lessor5, 2)
//     }
//   }
//   return q1.set({ rows, total5 }).save(null, { useMasterKey: true }).then(consola.success)
// }

// require('./run')(calculate5Percent)
