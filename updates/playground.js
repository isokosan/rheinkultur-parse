require('./run')(async () => {
  await $query('SpecialFormat').equalTo('sfCount', null).each(s => s.save(null, { useMasterKey: true }), { useMasterKey: true })
})
