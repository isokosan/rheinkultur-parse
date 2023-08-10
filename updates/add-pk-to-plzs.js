async function savePkToPlzs () {
  let s = 0
  await $query('PLZ')
    .equalTo('pk', null)
    .eachBatch(async (items) => {
      for (const item of items) {
        await item.set('pk', $pk(item)).save(null, { useMasterKey: true, context: { skipIndexCubes: true } })
        s++
      }
    }, { useMasterKey: true })
  console.log({ s })
}

require('./run')(() => savePkToPlzs())
