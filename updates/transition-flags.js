require('./run')(async () => {
  await Parse.Cloud.run('fix-flags', null, { useMasterKey: true }).then(console.log)
})
