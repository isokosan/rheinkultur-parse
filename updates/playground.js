require('./run')(async () => {
  // const key = 'sync_cube_statuses'
  // const key = 'reindex_cubes'
  // await Parse.Cloud.run('queue-jobs', { key }, { useMasterKey: true })
  //   .then(console.log)

  await Parse.Cloud.run('contracts-wip-find-missing-periods', { contractId: 'BOFo4cG85u', apply: true }, { useMasterKey: true })
    .then(console.log)
})
