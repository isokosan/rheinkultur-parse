require('./run')(async () => {
  const contract = await $getOrFail('Contract', '9TkRbGTzPF')
  const autoExtendsBy = 12
  const changes = $changes(contract, { autoExtendsBy })
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
  contract.set({ autoExtendsBy })
  const audit = { fn: 'contract-update', data: { changes } }
  await contract.save(null, { useMasterKey: true, context: { audit } })
})
