async function cubeData () {
  let c = 0
  await $query('Contract')
    .greaterThanOrEqualTo('status', 3)
    .equalTo('cubeData', null)
    .select('cubeIds')
    .each(async (contract) => {
      contract.set('cubeData', await $query('Cube')
        .containedIn('objectId', contract.get('cubeIds'))
        .include(['hsnr', 'str', 'plz', 'ort', 'state', 'media', 'ht', 'hti'])
        .limit(contract.get('cubeIds').length)
        .find({ useMasterKey: true })
        .then(cubes => cubes.reduce((acc, cube) => {
          acc[cube.id] = {
            hsnr: cube.get('hsnr'),
            str: cube.get('str'),
            plz: cube.get('plz'),
            ort: cube.get('ort'),
            stateId: cube.get('state').id,
            media: cube.get('media'),
            htId: cube.get('ht')?.id
          }
          return acc
        }, {}))
      )
      console.info(contract.get('cubeData'))
      await contract.save(null, { useMasterKey: true })
      c++
    }, { useMasterKey: true })
  console.info('done', c)
}

require('./run')(() => cubeData())
