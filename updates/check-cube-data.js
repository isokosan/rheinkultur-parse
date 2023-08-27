async function check () {
  const updated = {}
  const monday = moment().startOf('isoWeek')
  await $query('Audit')
    .equalTo('fn', 'contract-finalize')
    .greaterThanOrEqualTo('createdAt', monday.toDate())
    .each(async (audit) => {
      const contractId = audit.get('itemId')
      if (updated[contractId]) return
      const contract = await $getOrFail('Contract', contractId)
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
      console.info(contract.get('no'))
      await contract.save(null, { useMasterKey: true })
      updated[contractId] = true
    }, { useMasterKey: true })
  console.info('done', Object.keys(updated).length)
}

require('./run')(() => check())
