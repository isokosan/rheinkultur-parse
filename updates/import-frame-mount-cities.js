require('./run')(async () => {
  // check if Stadtkultur GmbH has a test user
  const users = [
    {
      email: 'nga.vu@stadtkultur-online.de',
      firstName: 'Nga',
      lastName: 'Vu',
      accType: 'partner',
      permissions: ['manage-frames'],
      companyId: '19me3Ge8LZ',
      password: 'kCDbuJtQjl'
    },
    {
      email: 'dagmar.ande@stadtkultur-online.de',
      firstName: 'Dagmar',
      lastName: 'Ande',
      accType: 'partner',
      permissions: ['manage-frames'],
      companyId: '19me3Ge8LZ',
      password: 'W2Lgsb42wd'
    }
  ]
  for (const user of users) {
    const exists = await $query(Parse.User).equalTo('email', user.email).first({ useMasterKey: true })
    if (!exists) {
      await Parse.Cloud.run('user-invite', user, { useMasterKey: true })
    }
  }
})
