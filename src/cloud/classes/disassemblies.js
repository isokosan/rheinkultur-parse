Parse.Cloud.define('disassembly-order-update', async ({
  params: {
    className,
    id,
    disassembly
  }, user
}) => {
  const bc = await $query(className).get(id, { useMasterKey: true })
  const changes = $changes(bc, { disassembly })
  bc.set({ disassembly })
  const audit = { user, fn: className.toLowerCase() + '-update', data: { changes } }
  return bc.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })
