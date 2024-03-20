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
  for (const user of users) {
    const exists = await $query(Parse.User).equalTo('email', user.email).first({ useMasterKey: true })
    if (!exists) {
      await Parse.Cloud.run('user-invite', user, { useMasterKey: true })
    }
  }
  const intern = [
    'denizar@gmail.com',
    'rwe@rheinkultur-medien.de',
    'gwe@rheinkultur-medien.de'
  ]
  let p = 0
  for (const email of intern) {
    const user = await $query(Parse.User).equalTo('email', email).first({ useMasterKey: true })
    // add permission manage-frames
    const permissions = user.get('permissions') || []
    if (!permissions.includes('manage-frames')) {
      permissions.push('manage-frames')
      user.set('permissions', permissions)
      await user.save(null, { useMasterKey: true })
      p++
    }
  }
  console.log(p)
})
