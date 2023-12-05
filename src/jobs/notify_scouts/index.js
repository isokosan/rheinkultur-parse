module.exports = async function (job) {
  const today = await $today()
  const startingTodayTaskListQuery = $query('TaskList')
    .containedIn('status', [2, 3])
    .equalTo('date', today)
  const count = await startingTodayTaskListQuery.count({ useMasterKey: true })
  let i = 0
  await startingTodayTaskListQuery.each(async taskList => {
    await taskList.save(null, { useMasterKey: true, context: { notifyScouts: true } })
    i++
    job.progress(parseInt((i / count) * 100))
  }, { useMasterKey: true })
  return Promise.resolve({ i })
}
