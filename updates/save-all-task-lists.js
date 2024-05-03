require('./run')(async () => {
  await $query('TaskList')
    .containedIn('status', [2, 3])
    .eachBatch(async (taskLists) => {
      await Parse.Object.saveAll(taskLists, { useMasterKey: true })
      console.log(`Saved ${taskLists.length} task lists`)
    }, { useMasterKey: true })
  console.log('All task lists saved')
})
