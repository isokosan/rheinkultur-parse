async function cubeData () {
  function getCubeData (cube) {
    return {
      hsnr: cube.get('hsnr'),
      str: cube.get('str'),
      plz: cube.get('plz'),
      ort: cube.get('ort'),
      stateId: cube.get('state').id,
      media: cube.get('media'),
      htId: cube.get('ht')?.id
    }
  }
  let c = 0
  await $query('Contract')
    .greaterThanOrEqualTo('status', 3)
    // .equalTo('cubeData', null)
    .select('cubeIds')
    .each(async (contract) => {
      contract.set('cubeData', await $query('Cube')
        .containedIn('objectId', contract.get('cubeIds'))
        .select(['hsnr', 'str', 'plz', 'ort', 'state', 'media', 'ht', 'hti'])
        .limit(contract.get('cubeIds').length)
        .find({ useMasterKey: true })
        .then(cubes => cubes.reduce((acc, cube) => {
          acc[cube.id] = getCubeData(cube)
          return acc
        }, {}))
      )
      console.info(contract.get('cubeData'))
      await contract.save(null, { useMasterKey: true })
      c++
    }, { useMasterKey: true })
  let b = 0
  await $query('Booking')
    .greaterThanOrEqualTo('status', 3)
    // .equalTo('cubeData', null)
    .include('cube')
    .each(async (booking) => {
      const cube = booking.get('cube')
      booking.set('cubeData', {
        [cube.id]: getCubeData(cube)
      })
      console.info(booking.get('cubeData'))
      await booking.save(null, { useMasterKey: true })
      b++
    }, { useMasterKey: true })
  console.info({ c, b })
}

require('./run')(() => cubeData())
