const backupDisassemblies = async () => {
  for (const className of ['Contract', 'Booking']) {
    await $query(className)
      .equalTo('disassembly', true)
      .equalTo('disassemblyBackup', null)
      .eachBatch(async (batch) => {
        for (const item of batch) {
          consola.info(item.get('no'))
          await item.set('disassemblyBackup', {
            fromRMV: item.get('disassembly')
          }).save(null, { useMasterKey: true })
        }
      }, { useMasterKey: true })
  }
}

// const restoreDisassemblies = async () => {
//   for (const className of ['Contract', 'Booking']) {
//     await $query(className)
//       .equalTo('disassembly', null)
//       .notEqualTo('disassemblyBackup', null)
//       .eachBatch(async (batch) => {
//         for (const item of batch) {
//           consola.info(item.get('no'))
//           await item.set('disassembly', item.get('disassemblyBackup')).save(null, { useMasterKey: true })
//         }
//       }, { useMasterKey: true })
//   }
// }

require('./run')(backupDisassemblies)
