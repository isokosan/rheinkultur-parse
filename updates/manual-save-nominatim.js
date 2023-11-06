require('./run')(async () => {
  let i = 0
  const query = $query('Cube')
    .notEqualTo('gp', null)
    .equalTo('nominatimAddress', null)
  const remaining = await query.count({ useMasterKey: true })
  await query
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
      console.log('saved', i, 'out of', remaining)
    }, { useMasterKey: true })
  console.log('DONE', i)
})
