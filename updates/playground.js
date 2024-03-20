require('./run')(async () => {
  // now transition flag TTMR'S
  const cubes = await $query('Cube').equalTo('flags', 'TTMR')
    .limit(1000)
    .select('pk')
    .find({ useMasterKey: true })
  const locations = {}
  for (const cube of cubes) {
    locations[cube.get('pk')] = locations[cube.get('pk')] || []
    locations[cube.get('pk')].push(cube.id)
  }
  for (const pk of Object.keys(locations)) {
    const fm = await $query('FrameMount').equalTo('pk', pk).first({ useMasterKey: true })
    await fm.set('cubeIds', locations[pk]).save(null, { useMasterKey: true })
  }
})
