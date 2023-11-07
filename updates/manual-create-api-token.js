require('./run')(async () => {
  const apiToken = new (Parse.Object.extend('ApiToken'))({
    company: $parsify('Company', 'GdvpJKEV3m') // Auprion
  })
  await apiToken.save(null, { useMasterKey: true })
  console.log('OK')
})
