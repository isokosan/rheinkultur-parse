// async function switchCube (contractNo, fromId, toId) {
//   const contract = await $query('Contract').equalTo('no', contractNo).first({ useMasterKey: true })
//   if (!contract) { throw new Error('Contract not found') }
//   const cubeIds = contract.get('cubeIds')
//   if (!cubeIds.includes(fromId)) { throw new Error('Cube not in contract') }

//   const index = cubeIds.indexOf(fromId)
//   cubeIds[index] = toId
//   contract.set({ cubeIds })

//   const monthlyMedia = contract.get('monthlyMedia')
//   if (monthlyMedia && monthlyMedia[fromId]) {
//     monthlyMedia[toId] = monthlyMedia[fromId]
//     delete monthlyMedia[fromId]
//     contract.set({ monthlyMedia })
//   }

//   await contract.save(null, { useMasterKey: true, context: { setCubeStatuses: true, recalculatePlannedInvoices: true } })
//   const comment = `Der falsch angelegte CityCube ${fromId} wurde durch CityCube ${toId} ersetzt.`
//   await Parse.Cloud.run('comment-create', {
//     itemId: contract.id,
//     itemClass: 'Contract',
//     text: comment
//   }, { useMasterKey: true })
// }

// require('./run')(() => switchCube('V20-0651', 'TLK-82822A38', 'TLK-82822A41'))
