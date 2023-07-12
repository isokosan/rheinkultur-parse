async function set () {
  for (const className of ['Briefing', 'Control', 'Disassembly']) {
    await $query(className).equalTo('counts', null).each(async (item) => {
      await item.save(null, { useMasterKey: true })
      console.log(className, item.id)
    }, { useMasterKey: true })
  }
  const control = await $getOrFail('Control', 'aY1lAmp9Ap')
  await control.set('status', 1).save(null, { useMasterKey: true })
}

require('./run')(set)
