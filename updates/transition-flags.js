require('./run')(async () => {
  // pipeline to get ids where flags equal empty array
  const flagUnsets = await $query('Cube')
    .aggregate([
      { $match: { flags: [] } },
      { $project: { _id: 1 } }
    ], { useMasterKey: true })
  let i = 0
  console.log(flagUnsets.length)
  await $query('Cube')
    .containedIn('objectId', flagUnsets.map(({ objectId }) => objectId))
    .eachBatch(async (cubes) => {
      for (const cube of cubes) {
        await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      }
      i += cubes.length
      console.log(`Progress: ${parseInt(i / flagUnsets.length * 100)}%`)
    }, { useMasterKey: true })
})
