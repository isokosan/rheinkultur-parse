const { setCubeOrderStatuses } = require('@/shared')

Parse.Cloud.define('manual-updates-set-cube-statuses', ({ params: { orderClass, orderId } }) => {
  return $getOrFail(orderClass, orderId).then(setCubeOrderStatuses)
}, { requireMaster: true })

Parse.Cloud.define('manual-updates-disassemblies', async () => {
  // TBS
  const contractNos = [
    'V22-0404',
    'V22-0427',
    'V22-0484',
    'V22-0628',
    'V22-0763',
    'V22-0984'
  ]
  const tbsQuery = $query('Contract').containedIn('no', contractNos)
  const kinetic = await $query('Company').equalTo('name', 'Kinetic Germany GmbH').first({ useMasterKey: true })
  const kineticQuery = $query('Contract').equalTo('company', kinetic)
  const query = Parse.Query.or(tbsQuery, kineticQuery)
    .notEqualTo('disassembly', true)
  const nos = []
  while (true) {
    const contract = await query.first({ useMasterKey: true })
    if (!contract) { break }
    contract.set({ disassembly: true })
    await contract.save(null, { useMasterKey: true })
    nos.push(contract.get('no'))
  }
  return nos
})
