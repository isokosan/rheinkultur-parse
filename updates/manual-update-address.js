require('./run')(async () => {
  const nos = [
    'V22-0753',
    'V21-0855',
    'V21-0765',
    'V21-0868',
    'V21-0830',
    'V21-0631'
  ]
  const address = await $getOrFail('Address', 'JuEHnRNpek')
  await $query('Contract')
    .containedIn('no', nos)
    .equalTo('company', address.get('company'))
    .notEqualTo('address', address)
    .each(async contract => {
      contract.set('address', address)
      await contract.save(null, { useMasterKey: true })
      console.log(`Contract ${contract.get('no')} updated`)
    }, { useMasterKey: true })
})
