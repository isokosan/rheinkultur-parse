require('./run')(async () => {
  await Parse.Cloud.run('queue-jobs', { key: 'reindex_cubes' }, { useMasterKey: true })
    .then(console.log)
})