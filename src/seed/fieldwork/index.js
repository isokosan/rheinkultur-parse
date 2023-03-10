// async function locations() {
//   const lists = await $query('DepartureList')
//     .select(['ort', 'state', 'cubeIds'])
//     .limit(10000)
//     .find({ useMasterKey: true })
//   const locations = {}
//   for (const list of lists) {
//     const { cubeIds, ort, state } = list.attributes
//     const location = [ort, state.id].join(':')
//     locations[location] = true
//   }
//   return Object.keys(locations)
// }
// locations().then(consola.info)

// $query('DepartureList').each(list => list.save(null, { useMasterKey: true }), { useMasterKey: true }).then(consola.success)
