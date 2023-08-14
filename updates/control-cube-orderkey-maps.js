// TOCHECK: SHOULD RETURN 0 EACH TIME
async function controlCubeOrderKeys () {
  let c = 0
  await $query('Control')
    .equalTo('cubeOrderKeys', null)
    .each(async (control) => {
      const cubeOrderKeys = {}
      await $query('Cube')
        .containedIn('objectId', control.get('cubeIds'))
        .select('order')
        .eachBatch(async (batch) => {
          for (const cube of batch) {
            let order = cube.get('order')
            if (!order) {
              const pastContractIds = await $query('Contract')
                .equalTo('cubeIds', cube.id)
                .distinct('objectId', { useMasterKey: true })
              if (pastContractIds.length !== 1) {
                console.log('past orders issue', cube.id, pastContractIds)
                continue
              }
              order = { className: 'Contract', objectId: pastContractIds[0] }
            }
            const { className, objectId } = order
            const orderKey = `${className}$${objectId}`
            console.log(cube.id, orderKey)
            cubeOrderKeys[cube.id] = orderKey
          }
        }, { useMasterKey: true })
      await control.set('cubeOrderKeys', cubeOrderKeys).save(null, { useMasterKey: true })
      c++
    }, { useMasterKey: true })
  console.log(c)
}

require('./run')(controlCubeOrderKeys)
