async function controlSubmissionOrderKeys () {
  let s = 0
  await $query('ControlSubmission')
    // .equalTo('orderKey', null)
    .include('cube')
    .eachBatch(async (batch) => {
      for (const submission of batch) {
        let order = submission.get('cube').get('order')
        if (!order) {
          const cubeId = submission.get('cube').id
          const pastContractIds = await $query('Contract')
            .equalTo('cubeIds', cubeId)
            .distinct('objectId', { useMasterKey: true })
          if (pastContractIds.length !== 1) {
            console.log('past orders issue', cubeId, pastContractIds)
            continue
          }
          order = { className: 'Contract', objectId: pastContractIds[0] }
        }
        const { className, objectId } = order
        const orderKey = `${className}$${objectId}`
        console.log(orderKey)
        await submission.set('orderKey', orderKey).save(null, { useMasterKey: true })
        s++
      }
    }, { useMasterKey: true })
  console.log(s)
}

require('./run')(controlSubmissionOrderKeys)
