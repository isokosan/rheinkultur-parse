// const csv = require('csvtojson')
// const fs = require('fs').promises
// const path = require('path')
// const { chunk } = require('lodash')
// const { promisify } = require('node:util')
// const request = promisify(require('request'))
// const { parseAsDigitString } = require('../src/utils')

// let stateIds
// let plzOrt
// let nMRs
// const load = async () => {
//   nMRs = await $query('PLZ').equalTo('nMR', true).distinct('objectId', { useMasterKey: true })
//   stateIds = await $query('State').find({ useMasterKey: true })
//     .then(states => states.reduce((acc, state) => ({ ...acc, [state.get('name')]: state.id }), {}))
//   const csvFilePath = path.resolve(__dirname, '../..', 'zuordnung_plz_ort.csv')
//   plzOrt = await csv({ trim: true, includeColumns: /(ort|plz|bundesland)/ }).fromFile(csvFilePath)
//     .then(rows => rows.map((row) => {
//       row.plz = parseAsDigitString(row.plz, 5)
//       row.pk = stateIds[row.bundesland] + ':' + row.ort
//       return row
//     }))
// }

// // return plzOrt.filter((row) => {
// //   const pattern_plz = new RegExp("^" + query + ".*$")
// //   const pattern_ort = new RegExp("\\b" + query + "\\b")
// //   const pattern_bundesland = new RegExp("^" + query + "$")
// //   return row.plz.match(pattern_plz) || row.ort.toLowerCase().match(pattern_ort) || row.bundesland.toLowerCase().match(pattern_bundesland)
// // })

// // const write = async () => {
// //   await load()
// //   const { features: plzs } = require('../../plz-5stellig.json')
// //   const data = plzs.map(({ properties: { plz, einwohner: population, qkm, nMR }, geometry }) => {
// //     const item = {
// //       plz: parseAsDigitString(plz, 5),
// //       population,
// //       qkm,
// //       geometry,
// //       pks: plzOrt.filter((row) => row.plz.match(new RegExp('^' + plz + '.*$'))).map(item => item.pk)
// //     }
// //     if (nMRs.includes(item.plz)) {
// //       item.nMR = true
// //     }
// //     return item
// //   })
// //   // write to new json file
// //   const filePath = path.resolve(__dirname, '../..', 'final.json')
// //   return fs.writeFile(filePath, JSON.stringify(data, null))
// // }

// // const savePlzs = async () => {
// //   const all = require('./../../final.json')
// //     .map(({ plz, population, qkm, pks, nMR }) => ({
// //       method: 'POST',
// //       path: '/parse/classes/PLZ/',
// //       body: {
// //         objectId: plz,
// //         population,
// //         pks,
// //         qkm,
// //         nMR
// //       }
// //     }))
// //   await (new Parse.Schema('PLZ')).purge()
// //   let i = 0
// //   for (const requests of chunk(all, 50)) {
// //     await request({
// //       url: `${process.env.PUBLIC_SERVER_URL}/batch`,
// //       method: 'POST',
// //       headers: {
// //         'Content-Type': 'application/json;charset=utf-8',
// //         'X-Parse-Application-Id': process.env.APP_ID,
// //         'X-Parse-MASTER-Key': process.env.MASTER_KEY
// //       },
// //       json: true,
// //       body: { requests }
// //     })
// //     i += requests.length
// //     console.log(`${i} of ${all.length}`)
// //   }
// // }

// // const savePolygons = async () => {
// //   const all = require('./../../final.json')
// //     .map(({ plz, geometry }) => {
// //       if (geometry.type === 'Polygon') {
// //         return [{
// //           plz,
// //           polygon: new Parse.Polygon(geometry.coordinates[0].map(([lng, lat]) => $geopoint(lat, lng)))
// //         }]
// //       }
// //       if (geometry.type === 'MultiPolygon') {
// //         return geometry.coordinates.map((coordinates) => ({
// //           plz,
// //           polygon: new Parse.Polygon(coordinates[0].map(([lng, lat]) => $geopoint(lat, lng)))
// //         }))
// //       }
// //       throw new Error('Other Type')
// //     })
// //     .flat()
// //     .map(({ plz, polygon }) => ({
// //       method: 'POST',
// //       path: '/parse/classes/PLZPolygon/',
// //       body: {
// //         plz: $pointer('PLZ', plz),
// //         polygon
// //       }
// //     }))

// //   await (new Parse.Schema('PLZPolygon')).purge()
// //   let i = 0
// //   for (const requests of chunk(all, 50)) {
// //     await request({
// //       url: `${process.env.PUBLIC_SERVER_URL}/batch`,
// //       method: 'POST',
// //       headers: {
// //         'Content-Type': 'application/json;charset=utf-8',
// //         'X-Parse-Application-Id': process.env.APP_ID,
// //         'X-Parse-MASTER-Key': process.env.MASTER_KEY
// //       },
// //       json: true,
// //       body: { requests }
// //     })
// //     i += requests.length
// //     console.log(`${i} of ${all.length}`)
// //   }
// // }

// // async function testFindRealOrt () {
// //   const brottewitzCube = $geopoint(51.46229695307144, 13.22054206417892)
// //   const plz = await $query('PLZPolygon')
// //     .polygonContains('polygon', brottewitzCube)
// //     .include('plz')
// //     .first({ useMasterKey: true })
// //   console.log(plz.get('plz').id, plz.get('plz').attributes)
// // }

// async function checkOrt () {
//   const orts = await $query('City').equalTo('state', $parsify('State', 'HE')).distinct('ort', { useMasterKey: true })
//   const lessThan5 = {}
//   for (const ort of orts) {
//     const count = await $query('Cube').equalTo('state', $parsify('State', 'HE')).equalTo('ort', ort).count({ useMasterKey: true })
//     if (count < 5) {
//       lessThan5[ort] = count
//     }
//   }
//   console.log(lessThan5)
// }

// https://wawi-api.isokosan.com/nominatim/reverse?format=jsonv2&lat=51.46229695307144&lon=13.22054206417892
// https://www.statistikportal.de/de/veroeffentlichungen/georeferenzierte-bevoelkerungszahlen

// const saveCityPopulations50 = async () => {
//   stateIds = await $query('State').find({ useMasterKey: true })
//     .then(states => states.reduce((acc, state) => ({ ...acc, [state.get('name')]: state.id }), {}))
//   const csvFilePath = path.resolve(__dirname, '../..', '50000.csv')
//   const populations = await csv({ trim: true }).fromFile(csvFilePath)
//   for (const { city, population, state } of populations) {
//     const stateId = stateIds[state]
//     if (!stateId) {
//       console.log('state not found', state)
//       continue
//     }
//     const cityObject = await $query('City')
//       .equalTo('ort', city)
//       .equalTo('state', $parsify('State', stateId))
//       .first({ useMasterKey: true })
//     if (!cityObject) {
//       console.log('city not found', city, state)
//       continue
//     }
//     if (!cityObject.get('population')) {
//       cityObject.set('population', parseInt(population))
//       await $saveWithEncode(cityObject, null, { useMasterKey: true })
//     }
//   }
// }

// require('./run')(saveCityPopulations50)
