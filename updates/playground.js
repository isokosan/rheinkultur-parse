require('./run')(() => {
  // const key = 'sync_cube_statuses'
  // const key = 'reindex_cubes'
  // await Parse.Cloud.run('queue-jobs', { key }, { useMasterKey: true })
  //   .then(console.log)
  // await Parse.Cloud.run('contracts-wip-find-missing-periods', { contractId: 'BOFo4cG85u', apply: true }, { useMasterKey: true })
  //   .then(console.log)

  // const cube = await $query('Cube').notEqualTo('order', null).first({ useMasterKey: true })
  // console.log(cube.get('order'))

  // const cube2 = await $query('Cube').notEqualTo('order.contract', null).first({ useMasterKey: true })
  // console.log(cube2.get('order'))

  // const cube3 = await $query('Cube').notEqualTo('order.canceledAt', null).first({ useMasterKey: true })
  // console.log(cube3.get('order'))

  return Parse.Cloud.run('play').then(console.log)
})
