async function clean () {
  let s = 0
  await $query('Notification')
    .containedIn('identifier', ['task-list-assigned', 'task-submission-rejected'])
    .notEqualTo('data.placeKey', null)
    .each(async (notification) => {
      const inProgress = await $query('TaskList')
        .equalTo('pk', notification.get('data').placeKey)
        .equalTo('scouts', notification.get('user'))
        .containedIn('status', [2, 3])
        .count({ useMasterKey: true })
      if (!inProgress) {
        s++
        return notification.destroy({ useMasterKey: true })
      }
  }, { useMasterKey: true })
  console.log({ s })
}

require('./run')(() => clean())
