require('./run')(async () => {
  for (const parent of ['Briefing', 'Control', 'Assembly', 'Disassembly', 'CustomService']) {
    let i = 0
    await $query(parent).each(async (item) => {
      await item.save(null, { useMasterKey: true, context: { syncStatus: true } })
      i++
      console.log('Updated', parent, i)
    }, { useMasterKey: true })
  }
  console.log('Done')
})
