const { round } = require('lodash')

module.exports = async function (job) {
  const contracts = await $query('Contract')
    .select('no')
    .limit(1000)
    .find({ useMasterKey: true })
  const total = contracts.length
  let i = 0
  const updates = {}
  for (const contract of contracts) {
    const updated = await Parse.Cloud.run('contract-update-planned-invoices', { id: contract.id }, { useMasterKey: true })
    if (updated) {
      updates[contract.get('no')] = updated
    }
    i++
    job.progress(round(100 * i / total))
  }
  return Promise.resolve({ updates })
}
