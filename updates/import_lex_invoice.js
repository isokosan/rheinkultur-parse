// require('dotenv').config()
// global.Parse = require('parse/node')
// // Parse.serverURL = process.env.PRODUCTION_SERVER_URL
// Parse.serverURL = process.env.PUBLIC_SERVER_URL
// console.log(Parse.serverURL)
// Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
// require('./../src/globals')

// const request = require('request')

// const Authorization = `Bearer ${process.env.LEX_ACCESS_TOKEN}`
// // const Authorization = `Bearer ${process.env.LEX_PROD_ACCESS_TOKEN}`
// const headers = {
//   Authorization,
//   Accept: 'application/json',
//   'Content-Type': 'application/json'
// }

// const htmlEncode = val => val.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// const lexApi = async (resourceurl, method = 'GET', body = {}) => {
//   return new Promise((resolve, reject) => {
//     return request({
//       url: 'https://api.lexoffice.io/v1' + resourceurl,
//       method,
//       body,
//       json: true,
//       headers,
//       timeout: 30000
//     }, function (error, response, body) {
//       if (error) {
//         if (error.status === 404) {
//           return reject(new Error('Lexoffice Ressource nicht gefunden'))
//         }
//         consola.info(error, body)
//         return reject(new Error('LexApi error: ' + error.message))
//       }
//       return resolve(body)
//     })
//   })
// }

// async function fixDuplicate(duplicateLexId, originalWaWiId) {
//   const { voucherNumber: lexNo, voucherStatus, files: { documentFileId: lexUri } } = await lexApi('/invoices/' + duplicateLexId, 'GET')
//   // reverse create a storno rechnung
//   const original = await $getOrFail('Invoice', originalWaWiId)
//   const {
//     date,
//     createdBy,
//     company,
//     address,
//     contract,
//     booking,
//     introduction,

//     paymentType,
//     dueDays,

//     media,
//     periodStart,
//     periodEnd,
//     gradualPrice,
//     gradualCount,

//     production,

//     agency,
//     commissionRate,
//     commission,

//     lessor,
//     lessorRate,

//     lineItems,

//     extraCols
//   } = original.attributes

//   const invoice = new (Parse.Object.extend('Invoice'))()
//   invoice.set({
//     status: 3,
//     date,
//     createdBy,
//     company,
//     address,
//     contract,
//     booking,
//     introduction,

//     lexId: duplicateLexId,
//     lexNo,
//     voucherStatus,
//     lexUri: `https://api.lexoffice.io/v1/invoices/` + lexUri,
//     paymentType,
//     dueDays,

//     media,
//     periodStart,
//     periodEnd,
//     gradualPrice,
//     gradualCount,

//     production,

//     agency,
//     commissionRate,
//     commission,

//     lessor,
//     lessorRate,

//     lineItems,

//     extraCols
//   })
//   await invoice.save(null, { useMasterKey: true })
//   return original.set('duplicateOf', invoice).save(null, { useMasterKey: true })
// }

// fixDuplicate('200b19f3-e824-4b40-9198-87f492151a1f', 'ZpK7iHzX4C').then(consola.info)
