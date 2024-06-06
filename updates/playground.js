require('./run')(async () => {
  const total = await $query('TaskList').notEqualTo('scouts', null).count({ useMasterKey: true })
  console.log('going over tasks with scouts', total)
  let t = 0
  let i = 0
  await $query('TaskList')
    .notEqualTo('scouts', null)
    .select('scouts')
    .eachBatch(async (tasks) => {
      const empty = tasks.filter(task => !task.get('scouts').length)
      if (empty.length) {
        await Parse.Object.saveAll(empty, { useMasterKey: true })
        console.log('empty scouts', empty.length)
        i += empty.length
      }
      t += tasks.length
    }, { useMasterKey: true, batchSize: 1000 })
  console.log('total tasks', t, 'empty scouts', i)
})
