module.exports = async function (job) {
  await $query('GradualPriceMap').each((gradualPriceMap) => {
    gradualPriceMap.save(null, { useMasterKey: true })
  }, { useMasterKey: true })
  return 'triggered recalculateGradualInvoices'
}
