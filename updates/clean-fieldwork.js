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
  for (const className of ['Contract', 'Booking']) {
    await $query(className).notEqualTo('disassembly.submissions', null).each(async (record) => {
      const disassembly = record.get('disassembly')
      delete disassembly.submissions
      record.set('disassembly', null)
      await record.save(null, { useMasterKey: true })
      consola.info('Disassembly submissions cache removed from ' + className + ' ' + record.id)
    }, { useMasterKey: true })
  }
}

require('./run')(cleanFieldwork)
