require('./run')(async () => {
  const hasAusbautreiber = $query('Cube')
    .equalTo('lc', 'TLK')
    .matches('importData.ausbautreiber', '^MBfD')
  const doesNotHaveAusbautreiber = Parse.Query.or(
    $query('Cube').equalTo('importData.ausbautreiber', null),
    $query('Cube').matches('importData.ausbautreiber', '^(?!MBfD).*')
  )
    .equalTo('lc', 'TLK')
  // hasAusbautreiber.count({ useMasterKey: true }).then(count => console.log('Has ausbautreiber:', count))
  // doesNotHaveAusbautreiber.count({ useMasterKey: true }).then(count => console.log('Doesnt have ausbautreiber:', count))

  await hasAusbautreiber
    .notEqualTo('MBfD', true)
    .count({ useMasterKey: true })
    .then(count => console.log('Ausbautreiber but does not have MBfD:', count))
    // .each(cube => {
    //   cube.set('MBfD', true)
    //   return $saveWithEncode(cube, null, { useMasterKey: true })
    //  }, { useMasterKey: true })

  await doesNotHaveAusbautreiber
    .equalTo('MBfD', true)
    .count({ useMasterKey: true })
    .then(count => console.log('MBfD but does not have ausbautreiber:', count))
    // .each(cube => {
    //   cube.unset('MBfD')
    //   return $saveWithEncode(cube, null, { useMasterKey: true })
    //  }, { useMasterKey: true })

  await $query('Cube')
    .equalTo('lc', 'TLK')
    .matches('importData.ausbautreiber', '^MBfD')
    .count({ useMasterKey: true })
    .then(count => console.log('Ausbautreiber:', count))

  await $query('Cube')
    .equalTo('lc', 'TLK')
    .equalTo('MBfD', true)
    .count({ useMasterKey: true })
    .then(count => console.log('MBfD:', count))
})
