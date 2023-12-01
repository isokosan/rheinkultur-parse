module.exports = async function (job) {
  const kinetic = await $getOrFail('Company', 'FNFCxMgEEr')
  const extendContractsQuery = $query('Contract')
    .equalTo('status', 3)
    .equalTo('canceledAt', null)
    .lessThan('autoExtendsAt', await $today())
    .ascending('autoExtendsAt')
    .notEqualTo('company', kinetic)
    .matchesQuery('company', $query('Company').notEqualTo('email', null))
  const endContractsQuery = Parse.Query.or(
    $query('Contract').notEqualTo('canceledAt', null),
    $query('Contract').equalTo('autoExtendsAt', null)
  )
    .equalTo('status', 3)
    .lessThan('endsAt', await $today())
    .ascending('endsAt')
    .notEqualTo('company', kinetic)
  const total = await Promise.all([extendContractsQuery, endContractsQuery].map(query => query.count({ useMasterKey: true })))
    .then(counts => counts.reduce((total, count) => total + count, 0))

  let extendedContracts = 0
  let endedContracts = 0

  while (true) {
    const contract = await extendContractsQuery.include(['company']).first({ useMasterKey: true })
    if (!contract) { break }
    consola.info('auto extending contract', contract.id, contract.get('company').get('email'))
    await Parse.Cloud.run('contract-extend', { id: contract.id, email: !DEVELOPMENT }, { useMasterKey: true })
    extendedContracts++
    job.progress(parseInt(100 * (extendedContracts + endedContracts) / total))
  }
  while (true) {
    const contract = await endContractsQuery.first({ useMasterKey: true })
    if (!contract) { break }
    consola.info('auto ending contract', contract.id)
    await Parse.Cloud.run('contract-end', { id: contract.id }, { useMasterKey: true })
    endedContracts++
    job.progress(parseInt(100 * (extendedContracts + endedContracts) / total))
  }
  return Promise.resolve({ extendedContracts, endedContracts })
}
