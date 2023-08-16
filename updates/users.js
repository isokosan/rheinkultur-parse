const { normalizeUsernameFromEmail } = require('../src/schema/normalizers')
async function check () {
  let i = 0
  await $query(Parse.User).each(async user => {
    const username = normalizeUsernameFromEmail(user.get('email'))
    if (username !== user.get('username')) {
      user.set('username', username)
      await user.save(null, { useMasterKey: true })
      console.log('updated', username)
      i++
    }
  }, { useMasterKey: true })
  console.log('DONE', i)
}

require('./run')(() => check())
