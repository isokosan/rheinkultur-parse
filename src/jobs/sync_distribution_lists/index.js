module.exports = async function (job) {
  const distributors = await $query('Company')
    .notEqualTo('distributor', null)
    .notEqualTo('distributor.periodicInvoicing', false)
    .find({ useMasterKey: true })
  for (const distributor of distributors) {
    await Parse.Cloud.run('distribution-lists', { id: distributor.id }, { useMasterKey: true })
  }
  return { distributors: distributors.length }
}
