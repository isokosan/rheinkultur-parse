async function removeAll (className) {
  let i = 0
  await $query(className).each(async (record) => {
    await record.destroy({ useMasterKey: true })
    i++
  }, { useMasterKey: true })
  consola.success(`${i} ${className} object(s) removed`)
}

const cleanFieldwork = async () => {
  await removeAll('ScoutSubmission')
  await removeAll('ControlSubmission')
  await removeAll('DisassemblySubmission')
  await removeAll('TaskList')
  await removeAll('Briefing')
  await removeAll('Control')
  await removeAll('Disassembly')
  // remove all notifications that are related to fieldwork
  const fieldworkNotifications = [
    'task-list-assigned',
    'task-submission-rejected'
  ]
  let n = 0
  await $query('Notification').containedIn('identifier', fieldworkNotifications).each(async (notification) => {
    await notification.destroy({ useMasterKey: true })
    n++
  }, { useMasterKey: true })
  consola.success(`${n} Notification object(s) removed`)
}

require('./run')(cleanFieldwork)
