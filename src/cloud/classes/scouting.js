// add for example remscheid cubes to digital scouting

// async function addRemscheidToDigitalScouting() {
//   // general selection query
//   const cubesQuery = $query('Cube')
//     .equalTo('ort', 'Remscheid')
//     .equalTo('dAt', null)
//     .equalTo('vAt', null)
//     .equalTo('bPLZ', null)
//     .equalTo('nMR', null)
//     .equalTo('MBfD', null)
//     .equalTo('PG', null)
//     .equalTo('Agwb', null)
//   return cubesQuery.eachBatch(async (cubes) => {
//     for (const cube of cubes) {
//       const scouting = {
//         scoutId: 'Dhpmc87x32',
//         type: 'digital'
//       }
//       await cube.set({ scouting }).save(null, { useMasterKey: true })
//     }
//     return Promise.resolve()
//   }, { useMasterKey: true })
// }
// addRemscheidToDigitalScouting().then(consola.info)
