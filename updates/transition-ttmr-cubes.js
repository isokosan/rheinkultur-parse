require('./run')(async () => {
  const cubes = await $query('Cube').equalTo('flags', 'TTMR')
    .limit(1000)
    .select('pk')
    .find({ useMasterKey: true })
  const pks = {}
  for (const cube of cubes) {
    pks[cube.get('pk')] = pks[cube.get('pk')] || []
    pks[cube.get('pk')].push(cube.id)
  }
  for (const pk of Object.keys(pks)) {
    const fm = await $query('FrameMount').equalTo('pk', pk).first({ useMasterKey: true })
    if (!fm) {
      console.log(pk)
      continue
    }
    await fm.set('cubeIds', pks[pk]).save(null, { useMasterKey: true })
  }
  consola.success('TTMRs transitioned')
})
