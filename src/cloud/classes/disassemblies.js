// Parse.Cloud.define('disassembly-update', async ({
//   params: {
//     className,
//     id,
//     disassemblyRMV
//   }, user
// }) => {
//   const bc = await $query(className).get(id, { useMasterKey: true })
//   const changes = $changes(bc, { disassemblyRMV })
//   bc.set({ disassemblyRMV })
//   const audit = { user, fn: 'disassembly-update', data: { changes } }
//   return bc.save(null, { useMasterKey: true, context: { audit } })
// }, { requireUser: true })
