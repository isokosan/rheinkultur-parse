require('./run')(async () => {
  // check if Stadtkultur GmbH has a test user
  const stadtkultur = await $getOrFail('Company', '19me3Ge8LZ')
  const user = await $query(Parse.User).equalTo('company', stadtkultur).first({ useMasterKey: true })
  // await user.destroy({ useMasterKey: true })
  if (!user) {
    await Parse.Cloud.run('user-invite', {
      email: 'test@stadtkultur-online.de',
      firstName: 'Stadkultur',
      lastName: '1',
      accType: 'partner',
      permissions: ['manage-frames'],
      companyId: '19me3Ge8LZ',
      password: '123456'
    }, { useMasterKey: true })
  }
})
