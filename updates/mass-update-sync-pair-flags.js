require('./run')(async () => {
  let i = 0
  let a = 0
  let r = 0
  await $query('Cube')
    .equalTo('lc', 'TLK')
    .notEqualTo('pair', null) // ausgeblendet (meldungen should come from the pair)
    .notEqualTo('flags', null)
    .select('flags', 'pair')
    .include('pair')
    .eachBatch(async (batch) => {
      for (const cube of batch) {
        const flags = cube.get('flags').filter(flag => flag !== 'bPLZ' && flag !== 'PDGA' && flag !== 'SSgB')
        if (!flags.length) { continue }
        i++
        // save the meldungen to the pair
        const pair = cube.get('pair')
        const pairFlags = pair.get('flags') || []
        console.log(cube.id, flags, pairFlags)
        pair.set('flags', [...new Set([...pairFlags, ...flags])])
        // only save if the flags have changed
        if (pairFlags.length === pair.get('flags').length) { continue }
        await pair.save(null, { useMasterKey: true })
        if (cube.id.includes('A')) {
          a++
          continue
        }
        r++
      }
    }, { useMasterKey: true })
  console.log('Total', { i, a, r })
})
