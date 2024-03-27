require('./run')(async () => {
  // transition PLZ nMR's
  let i = 0
  await $query('PLZ')
    .equalTo('nMR', true)
    .equalTo('blk', null)
    .eachBatch(async (records) => {
      for (const record of records) {
        record.set('blk', record.get('pks'))
        await record.save(null, { useMasterKey: true, context: { skipSyncCubes: true } })
        i++
      }
      console.log(i)
    }, { useMasterKey: true })
  console.log('done')
})
