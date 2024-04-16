require('./run')(async () => {
  let i = 0
  const total = await $query('Cube')
    .containedIn('hti', ['59', '82', '82 A', '82 B', '82 C', '83', '92'])
    .count({ useMasterKey: true })
  await $query('Cube')
    .containedIn('hti', ['59', '82', '82 A', '82 B', '82 C', '83', '92'])
    .eachBatch(async (cubes) => {
      for (const cube of cubes) {
        await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
        i++
      }
      console.log(`progress: ${parseInt(i / total * 100)}%`)
    }, { useMasterKey: true })
  console.log('DONE')
})
