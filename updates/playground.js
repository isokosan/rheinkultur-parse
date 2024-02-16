require('./run')(async () => {
  await $query('Cube')
    .equalTo('ort', 'Altdorf')
    .equalTo('plz', '84032')
    .equalTo('state', $pointer('State', 'RP'))
    .equalTo('nominatimAddress.state', 'Bayern')
    .each(async (cube) => {
      cube.set('state', $pointer('State', 'BY'))
      await $saveWithEncode(cube, null, { useMasterKey: true })
    }, { useMasterKey: true })
})
