require('./run')(async() => {
  await $query('Contract').equalTo('pricingModel', 'fixed').aggregate([
    { $group: { _id: '$company', count: { $sum: 1 } } }
  ]).then(console.log)
})