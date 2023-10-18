require('./run')(async () => {
  const trackUsers = [
    'taubethomas@icloud.com'
    // 'denizar@gmail.com'
  ]
  await $query(Parse.User)
    .notEqualTo('logRocket', true)
    .containedIn('email', trackUsers)
    .each(user => user.set('logRocket', true).save(null, { useMasterKey: true, context: { clearSessions: true } }), { useMasterKey: true })
  await $query(Parse.User)
    .equalTo('logRocket', true)
    .notContainedIn('email', trackUsers)
    .each(user => user.set('logRocket', null).save(null, { useMasterKey: true, context: { clearSessions: true } }), { useMasterKey: true })
})
