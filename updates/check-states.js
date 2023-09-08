// async function check () {
//   const states = await $query('State').find({ useMasterKey: true })
//   for (const state of states) {
//     const cubes = await $query('Cube')
//       .equalTo('importData.date', '2023-09-02')
//       .equalTo('importData.state', state.get('name'))
//       .include('state')
//       .notEqualTo('state', state)
//       .find({ useMasterKey: true })
//     for (const cube of cubes) {
//       const verifiedAddress = cube.get('str') + ' ' + cube.get('hsnr') + ', ' + cube.get('plz') + ' ' + cube.get('ort') + ' ' + cube.get('state').get('name')
//       const { str, hsnr, plz, ort } = cube.get('importData')
//       const address = str + ' ' + hsnr + ', ' + plz + ' ' + ort + ' ' + state.get('name')
//       console.log('----')
//       console.log(verifiedAddress)
//       console.log(address)
//       cube.set({ str, hsnr, plz, ort, state })
//       cube.id = encodeURIComponent(cube.id)
//       await cube.save(null, { useMasterKey: true, context: { updating: true } })
//     }
//   }
// }

// require('./run')(() => check())
