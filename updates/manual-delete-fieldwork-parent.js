async function clean () {
  // briefings
  await $query('Briefing').containedIn('objectId', []).each(async (briefing) => {
    // delete all submissions
    const taskListQuery = $query('TaskList').equalTo('briefing', briefing)
    await $query('ScoutSubmission').matchesQuery('taskList', taskListQuery).each(async (submission) => {
      await submission.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
    await taskListQuery.each(async (taskList) => {
      await taskList.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
    await briefing.destroy({ useMasterKey: true })
    console.info('Briefing removed')
  }, { useMasterKey: true })

  // controls
  await $query('Control').containedIn('objectId', ['056ABySF2a']).each(async (control) => {
    // delete all submissions
    const taskListQuery = $query('TaskList').equalTo('control', control)
    await $query('ControlSubmission').matchesQuery('taskList', taskListQuery).each(async (submission) => {
      await submission.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
    await taskListQuery.each(async (taskList) => {
      await taskList.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
    await control.destroy({ useMasterKey: true })
    console.info('Control removed')
  }, { useMasterKey: true })

  // disassemblies
  await $query('Contract').containedIn('objectId', []).each(async (contract) => {
    // delete all submissions
    const disassembliesQuery = $query('Disassembly').equalTo('contract', contract)
    const taskListQuery = $query('TaskList').matchesQuery('disassembly', disassembliesQuery)
    await $query('DisassemblySubmission').matchesQuery('taskList', taskListQuery).each(async (submission) => {
      await submission.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
    await taskListQuery.each(async (taskList) => {
      await taskList.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
    await disassembliesQuery.each(async (disassembly) => {
      await disassembly.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
    await contract.set('status', 2).save(null, { useMasterKey: true })
    await contract.destroy({ useMasterKey: true })
    console.info('Contract removed')
  }, { useMasterKey: true })
}

require('./run')(clean)
