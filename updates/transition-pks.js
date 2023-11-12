// require('./run')(async () => {
//   const query = $query('Cube').equalTo('pk', null)
//   const count = await query.count({ useMasterKey: true })
//   console.log('starting', count)
//   let i = 0
//   await query.eachBatch(async (cubes) => {
//     for (const cube of cubes) {
//       await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
//       i++
//     }
//     console.log('progress', i, count)
//   }, { useMasterKey: true })
//   console.log('done', i)

//   // const query = $query('TaskList').equalTo('pk', null)
//   // const count = await query.count({ useMasterKey: true })
//   // console.log('starting', count)
//   // let i = 0
//   // await query.eachBatch(async (taskLists) => {
//   //   for (const taskList of taskLists) {
//   //     await taskList.save(null, { useMasterKey: true })
//   //     i++
//   //   }
//   //   console.log('progress', i, count)
//   // }, { useMasterKey: true })
//   // console.log('done', i)
// })
