require('./run')(async () => {
  await Parse.Cloud.run('seed-frame-mount-locations', {}, { useMasterKey: true })
})
