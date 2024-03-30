require('./run')(async () => {
  const query = $query('Cube').notEqualTo('fmk', null)
  const total = await query.count({ useMasterKey: true })
  let i = 0
  await query.eachBatch(async cubes => {
    for (const cube of cubes) {
      await $saveWithEncode(cube, null, { useMasterKey: true })
    }
    i += cubes.length
    console.log(`${i} / ${total}, ${parseInt(i / total * 100)}%`)
  }, { useMasterKey: true, batchSize: 1000 })
  console.log('DONE', total)
})
