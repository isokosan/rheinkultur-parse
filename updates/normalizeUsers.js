const normalizeEmail = (value) => {
  const [username, domain] = value
    .trim()
    .toLowerCase()
    .split('@')
  return [username.replace(/\./g, ''), domain].join('@')
}

async function normalize () {
  await $query(Parse.User).eachBatch(async (users) => {
    for (const user of users) {
      const email = normalizeEmail(user.get('email'))
      if (email !== user.get('email')) {
        user.set('email', email)
        user.set('username', email)
        await user.save(null, { useMasterKey: true })
        console.info('User updated', email)
      }
    }
  }, { useMasterKey: true })
}

require('./run')(normalize)
