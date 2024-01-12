// SHOULD BE { c: 0, d: 0, s: 0 }
require('./run')(async () => {
  const parentless = {
    control: 0,
    scout: 0,
    disassembly: 0,
    'special-format': 0

  }
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
          parentless.control++
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
          parentless.disassembly++
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
          parentless.scout++
          continue
        }
        console.log(task.get('briefing'))
      }
    }, { useMasterKey: true })
  const existingSpecialFormats = await $query('CustomService').equalTo('type', 'special-format').select('objectId').find({ useMasterKey: true })
  console.log(existingSpecialFormats.length, 'briefings')
  await $query('TaskList')
    .equalTo('type', 'special-format')
    .notContainedIn('customService', existingSpecialFormats)
    .eachBatch(async (tasks) => {
      console.log('special-formats', tasks.length)
      for (const task of tasks) {
        if (!task.get('customService')) {
          console.log('special format task cleaning', task.get('createdAt'))
          await task.destroy({ useMasterKey: true })
          parentless['special-format']++
          continue
        }
        console.log(task.get('customService'))
      }
    }, { useMasterKey: true })
  console.log(parentless)
})
