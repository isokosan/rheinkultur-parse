require('./run')(async () => {
  const plz = await $getOrFail('PLZ', '01067')
  const blacklisted = !plz.get('nMR')
  await plz.set('nMR', blacklisted).save(null, { useMasterKey: true, context: { reindexCubes: true } })
  console.log(plz.id, blacklisted ? 'blacklisted' : 'unblacklisted')
})
