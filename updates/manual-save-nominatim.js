require('./run')(async () => {
  let i = 0
  await $query('Cube')
    .notEqualTo('gp', null)
    .equalTo('nominatim', null)
    .select('gp')
    .eachBatch(async (cubes) => {
      for (const cube of cubes) {
        const { latitude, longitude } = cube.get('gp')
        const nominatim = await Parse.Cloud.run('nominatim', {
          lat: latitude,
          lon: longitude
        })
        cube.set('nominatimAddress', nominatim.address)
        await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
        i++
      }
      console.log(i)
    }, { useMasterKey: true })
  console.log('DONE', i)
})
