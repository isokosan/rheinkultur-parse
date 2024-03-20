require('./run')(async () => {
  // check if Stadtkultur GmbH has a test user
  const users = [
    {
      email: 'nga.vu@stadtkultur.de',
      firstName: 'Nga',
      lastName: 'Vu',
      accType: 'partner',
      permissions: ['manage-frames'],
      companyId: '19me3Ge8LZ',
      password: 'kCDbuJtQjl'
    },
    {
      email: 'dagmar.ande@stadtkultur.de',
      firstName: 'Dagmar',
      lastName: 'Ande',
      accType: 'partner',
      permissions: ['manage-frames'],
      companyId: '19me3Ge8LZ',
      password: 'W2Lgsb42wd'
    },
    {
      email: 'lars.reinhardt@stadtkultur.de',
      firstName: 'Lars',
      lastName: 'Reinhardt',
      accType: 'partner',
      permissions: ['manage-frames'],
      companyId: '19me3Ge8LZ',
      password: 'J8rgbV17Vo'
    }
  ]

  await $query(Parse.User)
    .contains('email', 'stadtkultur-online.de')
    .each((user) => {
      console.log(user.get('email'))
      console.log(user.get('username'))
      user.set('email', user.get('email').replace('stadtkultur-online.de', 'stadtkultur.de'))
      user.set('username', user.get('username').replace('stadtkultur-online.de', 'stadtkultur.de'))
      return user.save(null, { useMasterKey: true })
    }, { useMasterKey: true })

  for (const user of users) {
    const exists = await $query(Parse.User).equalTo('email', user.email).first({ useMasterKey: true })
    if (!exists) {
      await Parse.Cloud.run('user-invite', user, { useMasterKey: true })
    }
  }
})
