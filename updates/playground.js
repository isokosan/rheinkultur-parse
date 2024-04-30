require('./run')(async () => {
  const scout = await $query(Parse.User).get('GOsshefDf3', { useMasterKey: true })
  const assignedListIds = await $query('TaskList')
    .equalTo('scouts', scout)
    .containedIn('status', [2, 3])
    .distinct('objectId', { useMasterKey: true })
  await $query('Audit')
    .containedIn('itemId', assignedListIds)
})
