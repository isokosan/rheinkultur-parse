require('./run')(async () => {
  const disassemblyQuery = $query('Disassembly')
    .startsWith('orderKey', 'SpecialFormat')
    .equalTo('type', 'extra')
  await $query('TaskList')
    .matchesQuery('disassembly', disassemblyQuery)
    .select('objectId')
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        await Parse.Cloud.run('task-list-mark-complete', { id: taskList.id, skipSyncParentStatus: true }, { useMasterKey: true })
      }
    }, { useMasterKey: true })
})
