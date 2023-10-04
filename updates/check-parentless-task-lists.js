require('./run')(async () => {
  let c = 0
  let d = 0
  let s = 0
  const existingControls = await $query('Control').select('objectId').find({ useMasterKey: true })
  console.log(existingControls.length, 'controls')
  await $query('TaskList')
    .equalTo('type', 'control')
    .notContainedIn('control', existingControls)
    .eachBatch(async (tasks) => {
      console.log('control', tasks.length)
      for (const task of tasks) {
        if (!task.get('control')) {
          console.log('control task cleaning', task.get('createdAt'))
          await task.destroy({ useMasterKey: true })
          c++
          continue
        }
      }
    }, { useMasterKey: true })
  const existingDisassemblies = await $query('Disassembly').distinct('objectId', { useMasterKey: true }).then(ids => ids.map(id => $parsify('Disassembly', id)))
  console.log(existingDisassemblies.length, 'disassemblies')
  await $query('TaskList')
    .equalTo('type', 'disassembly')
    .notContainedIn('disassembly', existingDisassemblies)
    .eachBatch(async (tasks) => {
      for (const task of tasks) {
        if (!task.get('disassembly')) {
          await task.destroy({ useMasterKey: true })
          console.log('disassembly task cleaned')
          d++
        }
      }
    }, { useMasterKey: true })
  const existingBriefings = await $query('Briefing').select('objectId').find({ useMasterKey: true })
  console.log(existingBriefings.length, 'briefings')
  await $query('TaskList')
    .equalTo('type', 'scout')
    .notContainedIn('briefing', existingBriefings)
    .eachBatch(async (tasks) => {
      console.log('briefing', tasks.length)
      for (const task of tasks) {
        if (!task.get('briefing')) {
          console.log('briefing task cleaning', task.get('createdAt'))
          await task.destroy({ useMasterKey: true })
          s++
          continue
        }
        console.log(task.get('briefing'))
      }
    }, { useMasterKey: true })
  console.log({ c, d, s })
})
