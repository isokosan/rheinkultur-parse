require('./run')(async () => {
  const key = 'sync_cube_statuses'
  // const key = 'reindex_cubes'
  await Parse.Cloud.run('queue-jobs', { key }, { useMasterKey: true })
    .then(console.log)

  // const prods = await $query('Production').greaterThan('billing', 1).find({ useMasterKey: true })
  // for (const prod of prods) {
  //   console.log(prod.get('billing'))
  // }

})
