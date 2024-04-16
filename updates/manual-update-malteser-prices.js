require('./run')(async () => {
  // let i = 0
  // first set malteser to fixed pricing with auto updates
  // second set all malteser contracts to fixed pricing checking if prices are ok
  // then test extending contracts with the fixed pricing.
  // then add into company view a total number of contracts and cubes active counter
  const company = await $getOrFail('Company', '7BocaTOH9k')
  company.set('contractDefaults', {
    pricing: 'fixed',
    billingCycle: 6,
    invoicingAt: 'start',
    fixedPriceMap: {
      KVZ: 49,
      MFG: 65
    },
    autoUpdatePrices: true
  })
  await $query('Contract')
    .equalTo('company', company)
    .notEqualTo('pricingModel', 'fixed')
    .each(async (contract) => {
      await contract.set('pricingModel', 'fixed').save(null, { useMasterKey: true })
    }, { useMasterKey: true })
})
