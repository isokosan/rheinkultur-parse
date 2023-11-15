require('./run')(async () => {
  for (const className of ['Briefing', 'Control', 'Disassembly']) {
    await $query(className).notEqualTo('status', 5).each(obj => obj.save(null, { useMasterKey: true, context: { syncStatus: true } }), { useMasterKey: true })
    console.log(className, 'done')
  }
})
