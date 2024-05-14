require('./run')(async () => {
  // delete all VOD cubes
  await $query('Cube')
    .equalTo('lc', 'VOD')
    .eachBatch(async (cubes) => {
      for (const cube of cubes) {
        await cube.destroy({ useMasterKey: true })
        console.log(cube.id)
      }
      console.log(cubes.length)
    }, { useMasterKey: true })
  console.log('OK')
})
