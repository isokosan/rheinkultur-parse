/*
  SEED 5 Test Scouts
  SEED another 10 Test Scouts under Marc

  GENERATE ABBAU TASKS FOR Q4 04 to 06
  GENERATE KONTROL TASKS FOR KINETIC & ALDI
    - We have the specific list of orders for Kinetic
  GENERATE 5 EXAMPLE BRIEFINGS
    - Generate two briefings with cubes in the same Ort, and with overlapping yellow cubes in some
    - Add due date to the briefings, one in each week, and one overlapping in the first week (with overlapping cubes and orte so we can address this problem)

  GO TO DATE 03.04 (First week of April)
  In this case, we should have about 10.000 Kontrolle around Germany
  We should have between 100-150 Abbaue
  And we will have two Briefings for the week

  -> Pull a complete list of the tasks, and the ORTE that are included in this list.
  -> Try to now think about how this list will be divided between Scout Managers
  -> Then try to think as Scout Managers how these lists will be further divided for Scouts

  GO TO DATE 10.07 (Second week of April)
  We should have around another 100 Abbaue
  Imagine, what could have happened with the tasks from last week:
    - Some tasks might not be completed, especially waiting Abbau will be priority
    - Some Briefing quotas might still be open
  -> Think about how now we will choose and allocate the tasks now

  Other things to think about:
    - How will we allocate tasks in times when there is no Briefing?
    - How will we allocate all these thousands of Kontrollfahrten, because if we assign them to Marc, but then one of our scouts goes to an area nearby, don't we want to be able to get these Kontrolle done?

  Deniz:
    - Think about how we will be able to see the tasks that are assigned to a specific scout
    - Think about how we will be able to see the tasks that are assigned to a specific scout manager

*/

// generate abbau tasks
// async function generateDisassemblyTasks (periodStart, periodEnd) {
//   const endingQuery = Parse.Query.or(
//     $query('Cube').notEqualTo('order.canceledAt', null),
//     $query('Cube').notEqualTo('order.earlyCanceledAt', null),
//     $query('Cube').equalTo('order.autoExtendsAt', null)
//   )
//   const contractsQuery = $query('Contract').equalTo('disassembly', true)
//   const bookingsQuery = $query('Booking').equalTo('disassembly', true)
//   const disassemblyQuery = Parse.Query.or(
//     $query('Cube').matchesKeyInQuery('order.contract.objectId', 'objectId', contractsQuery),
//     $query('Cube').matchesKeyInQuery('order.booking.objectId', 'objectId', bookingsQuery)
//   )
//   const query = Parse.Query.and(endingQuery, disassemblyQuery)
//     .notEqualTo('order', null)
//     .greaterThanOrEqualTo('order.endsAt', moment(periodStart).subtract(1, 'day').format('YYYY-MM-DD'))
//     .lessThanOrEqualTo('order.endsAt', moment(periodEnd).subtract(1, 'day').format('YYYY-MM-DD'))

//   let i = 0
//   const count = await query.count({ useMasterKey: true })
//   return query.eachBatch(async (cubes) => {
//     for (const cube of cubes) {
//       const objectId = [cube.get('order').no, cube.id].join(':')
//       const from = moment(cube.get('order').endsAt).add(1, 'day').format('YYYY-MM-DD')
//       const exists = await $query('DisassemblyTask').equalTo('objectId', objectId).first({ useMasterKey: true })
//       if (exists) {
//         await exists.save(null, { useMasterKey: true })
//       } else {
//         const body = {
//           objectId,
//           cube: cube.toPointer(),
//           from,
//           until: moment(from).add(2, 'weeks').format('YYYY-MM-DD')
//         }
//         await Parse.Cloud.httpRequest({
//           method: 'POST',
//           url: `${process.env.PUBLIC_SERVER_URL}/classes/DisassemblyTask`,
//           headers: {
//             'Content-Type': 'application/json;charset=utf-8',
//             'X-Parse-Application-Id': process.env.APP_ID,
//             'X-Parse-Master-Key': process.env.MASTER_KEY
//           },
//           body
//         })
//       }
//       i++
//       consola.info('Disassembly', parseFloat(i / count * 100).toFixed(2) + '%')
//     }
//   }, { useMasterKey: true })
// }
// async function generateKineticKontrolle (controlDate) {
//   const nos = require('./../data/processed-kinetic-controls.json')[controlDate]
//     .map(no => 'V' + no)
//   const contractsQuery = $query('Contract').containedIn('no', nos)
//   const query = $query('Cube')
//     .matchesKeyInQuery('order.contract.objectId', 'objectId', contractsQuery)
//     .greaterThan('order.status', 2)
//     .lessThanOrEqualTo('order.startsAt', controlDate)
//     .greaterThan('order.endsAt', controlDate)

//   let i = 0
//   const count = await query.count({ useMasterKey: true })
//   return query.eachBatch(async (cubes) => {
//     for (const cube of cubes) {
//       const objectId = [cube.get('order').no, cube.id, controlDate].join(':')
//       const exists = await $query('ControlTask').equalTo('objectId', objectId).first({ useMasterKey: true })
//       if (exists) {
//         await exists.save(null, { useMasterKey: true })
//       } else {
//         const body = {
//           objectId,
//           cube: cube.toPointer()
//         }
//         await Parse.Cloud.httpRequest({
//           method: 'POST',
//           url: `${process.env.PUBLIC_SERVER_URL}/classes/ControlTask`,
//           headers: {
//             'Content-Type': 'application/json;charset=utf-8',
//             'X-Parse-Application-Id': process.env.APP_ID,
//             'X-Parse-Master-Key': process.env.MASTER_KEY
//           },
//           body
//         })
//       }
//       i++
//       consola.info('Control', parseFloat(i / count * 100).toFixed(2) + '%')
//     }
//   }, { useMasterKey: true })
// }
// async function generateBriefingAsTasks (briefing) {
//   const departureLists = await $query('DepartureList').equalTo('briefing', briefing).limit(1000).find({ useMasterKey: true })
//   const dueDate = departureLists[0].get('dueDate')
//   const cubeIds = departureLists.map(list => list.get('cubeIds')).flat()
//   const query = $query('Cube')
//     .containedIn('objectId', cubeIds)
//   let i = 0
//   const count = await query.count({ useMasterKey: true })
//   const dupes = []
//   await query.eachBatch(async (cubes) => {
//     for (const cube of cubes) {
//       const objectId = cube.id
//       const exists = await $query('ScoutTask').include('cube').equalTo('objectId', objectId).first({ useMasterKey: true })
//       if (exists) {
//         await exists.save(null, { useMasterKey: true })
//         dupes.push(objectId)
//       } else {
//         const body = {
//           objectId,
//           cube: cube.toPointer(),
//           until: dueDate
//         }
//         await Parse.Cloud.httpRequest({
//           method: 'POST',
//           url: `${process.env.PUBLIC_SERVER_URL}/classes/ScoutTask`,
//           headers: {
//             'Content-Type': 'application/json;charset=utf-8',
//             'X-Parse-Application-Id': process.env.APP_ID,
//             'X-Parse-Master-Key': process.env.MASTER_KEY
//           },
//           body
//         })
//       }
//       i++
//       consola.info('Scout', parseFloat(i / count * 100).toFixed(2) + '%')
//     }
//   }, { useMasterKey: true })
//   consola.warn(dupes)
// }
// $query('Briefing').find({ useMasterKey: true }).then(briefings => briefings.map(generateBriefingAsTasks))
// generateDisassemblyTasks('2023-04-01', '2023-06-30')
// generateKineticKontrolle()
// async function setBriefingDates () {
//   for (const briefing of await $query('Briefing').include('departureLists').find({ useMasterKey: true })) {
//     const dueDate = moment('2023-04-15')
//     for (const departureList of await $query('DepartureList').equalTo('briefing', briefing).find({ useMasterKey: true })) {
//       departureList.set('dueDate', dueDate.format('YYYY-MM-DD'))
//       await departureList.save(null, { useMasterKey: true })
//     }
//     dueDate.add(1, 'week')
//     consola.info('Briefing set')
//   }
// }
// setBriefingDates()
// async function reindexTasks () {
//   for (const taskClass of [
//     'ScoutTask',
//     'DisassemblyTask',
//     'ControlTask'
//   ]) {
//     await $query(taskClass).eachBatch(async (tasks) => {
//       for (const task of tasks) {
//         await task.save(null, { useMasterKey: true })
//       }
//       consola.info('reindexing')
//     }, { useMasterKey: true })
//   }
//   return 'DONE'
// }
// reindexTasks().then(consola.success)

// const DepartureList = Parse.Object.extend('DepartureList')
// async function generateControlDepartureLists () {
//   const controlTasks = await $query('ControlTask').include('cube').limit(15000).find({ useMasterKey: true })
//   const placeKeys = {}
//   for (const controlTask of controlTasks) {
//     const placeKey = [controlTask.get('cube').get('ort'), controlTask.get('cube').get('state').id].join('_')
//     if (!(placeKey in placeKeys)) {
//       placeKeys[placeKey] = []
//     }
//     placeKeys[placeKey].push(controlTask.get('cube').id)
//   }
//   for (const placeKey in placeKeys) {
//     const [ort, stateId] = placeKey.split('_')
//     const state = $pointer('State', stateId)
//     const departureList = new DepartureList({
//       type: 'control',
//       // control,
//       ort,
//       state,
//       cubeIds: placeKeys[placeKey],
//       dueDate: '2023-06-30'
//     })
//     await departureList.save(null, { useMasterKey: true })
//     consola.info('Control', ort)
//   }
//   consola.success('done')
// }
// generateControlDepartureLists()

// async function generateDisassemblyDepartureLists () {
//   const disassemblyTasks = await $query('DisassemblyTask').include('cube').limit(15000).find({ useMasterKey: true })
//   const placeKeys = {}
//   for (const disassemblyTask of disassemblyTasks) {
//     const week = moment(disassemblyTask.get('from')).isoWeek()
//     const weekPlaceKey = [disassemblyTask.get('cube').get('ort'), disassemblyTask.get('cube').get('state').id, week].join('_')
//     if (!(weekPlaceKey in placeKeys)) {
//       placeKeys[weekPlaceKey] = []
//     }
//     placeKeys[weekPlaceKey].push(disassemblyTask.get('cube').id)
//   }
//   for (const weekPlaceKey in placeKeys) {
//     const [ort, stateId, week] = weekPlaceKey.split('_')
//     const state = $pointer('State', stateId)
//     const departureList = new DepartureList({
//       type: 'disassembly',
//       // control,
//       ort,
//       state,
//       cubeIds: placeKeys[weekPlaceKey],
//       dueDate: moment().isoWeek(week).add(2, 'weeks').format('YYYY-MM-DD')
//     })
//     await departureList.save(null, { useMasterKey: true })
//     consola.info('Disassembly', ort, week)
//   }
//   consola.success('done')
// }
// generateDisassemblyDepartureLists()

/*
  ORTE with most cubes currently open
    'Berlin:BE' => 136
    'Lünen:NW' => 124
    'Karlsruhe:BW' => 116
    'Dortmund:NW' => 116
    'Alsdorf:NW' => 111
    'Viersen:NW' => 107
    'Freiburg im Breisgau:BW' => 106
    'Hagen:NW' => 102

  ✔ There are 341 ORTE that are in more than one BUNDESLAND
  => We need to combine ORT+STATE in selections for working with orte.
 */

// check same cubes in different Briefings:
// async function checkDuplicateScoutCubes() {
//   const cubeLists = await $query('DepartureList')
//     .equalTo('type', 'scout')
//     .select('cubeIds')
//     .find({ useMasterKey: true })
//     .then(results => results.map(result => result.get('cubeIds')))
//   const { intersection } = require('lodash')
//   return intersection(...cubeLists)
// }
// checkDuplicateScoutCubes().then(consola.warn)

// => TODO: Make some views of multiple lists per ORT in view of a scout app

// $query('Cube').equalTo('ort', 'Berlin').distinct('plz', { useMasterKey: true }).then(consola.warn)
// $query('Cube').equalTo('ort', 'Solingen').distinct('plz', { useMasterKey: true }).then(consola.warn)
