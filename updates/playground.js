require('./run')(async () => {
  let i = 0
  await $query(Parse.User)
    .containedIn('objectId', ['YxuxJiEq7g', 'PALgvoyg3O'])
    .each(async (user) => {
      const permissions = user.get('permissions')
      let changed = false
      for (const item of ['manage-scouts', 'manage-fieldwork']) {
        if (!permissions.includes(item)) {
          permissions.push(item)
          changed = true
        }
      }
      if (changed) {
        await user.set({ permissions }).save(null, { useMasterKey: true })
        i++
      }
      console.log(user.get('firstName'), permissions)
    }, { useMasterKey: true })
  console.log(i)
  return i
})
