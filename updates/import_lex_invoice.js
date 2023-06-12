// const request = require('request')

// // const Authorization = `Bearer ${process.env.LEX_ACCESS_TOKEN}`
// const Authorization = `Bearer ${process.env.LEX_PROD_ACCESS_TOKEN}`
// const headers = {
//   Authorization,
//   Accept: 'application/json',
//   'Content-Type': 'application/json'
// }

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

// async function fixDuplicate (duplicateLexId, originalWaWiId) {
//   const { voucherNumber: lexNo, voucherStatus } = await lexApi('/invoices/' + duplicateLexId, 'GET')
//   // reverse create a storno rechnung
//   const original = await $getOrFail('Invoice', originalWaWiId)
//   if (original.get('duplicateOf')) { throw new Error('Already fixed') }
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
//     lexUri: 'https://api.lexoffice.io/v1/invoices/' + duplicateLexId,
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

// const fixDuplicates = async () => {
//   const DUPLICATES = [
//     // RE23-01025 & RE23-01026
//     // ['f11008be-d7d8-483e-8287-b736008d0a75', 'ugu3PVoeGg'],
//     // RE23-01052 & RE23-01053
//     // ['988c813c-a91e-4f50-8313-e4ef77c4e026', 'CzIuWUU0XC'],
//     // RE23-01211 & RE23-01212
//     // ['97a12107-e333-40b8-80a8-21cb3fc4897b', 'HX3ODht6Ue'],
//     // RE23-01083 & RE23-01082
//     // ['c222e9db-7832-48f6-a9ea-a71a7d964d78', 'bSuepp8ezS']
//   ]
//   for (const [duplicateLexId, originalWaWiId] of DUPLICATES) {
//     await fixDuplicate(duplicateLexId, originalWaWiId)
//     return 'OK'
//   }
// }
