require('./run')(async () => {
  await $query('Control')
    .greaterThan('createdAt', { $relativeTime: '1 hour ago' })
    .each(async (control) => {
      await control.destroy({ useMasterKey: true })
    }, { useMasterKey: true })

  for (const quarter of [
    'Q2',
    'Q3',
    'Q4'
  ]) {
    const date = moment().quarter(quarter.slice(1)).startOf('quarter').format('YYYY-MM-DD')
    const dueDate = moment(date).endOf('quarter').format('YYYY-MM-DD')
    const untilDate = moment(dueDate).add(1, 'month').format('YYYY-MM-DD')
    const startedBefore = moment(date).subtract(3, 'months').format('YYYY-MM-DD')
    const startQuarter = 'Q' + moment(date).subtract(2, 'quarters').quarter()
    const name = 'Groupm ' + quarter + '-2024 APPROACH-C (A&B Combined)'
    const orderType = 'Contract'
    const lastControlBefore = 12
    const criteria = [{ type: 'Company', value: 'FNFCxMgEEr', op: 'include' }]
    await Parse.Cloud.run('control-create', { name, criteria, startQuarter, orderType, lastControlBefore, date, dueDate, startedBefore, untilDate }, { useMasterKey: true })
  }
  for (const quarter of [
    'Q1',
    'Q2',
    'Q3',
    'Q4'
  ]) {
    const date = moment().quarter(quarter.slice(1)).year(2025).startOf('quarter').format('YYYY-MM-DD')
    const dueDate = moment(date).endOf('quarter').format('YYYY-MM-DD')
    const untilDate = moment(dueDate).add(1, 'month').format('YYYY-MM-DD')
    const startedBefore = moment(date).subtract(3, 'months').format('YYYY-MM-DD')
    const startQuarter = 'Q' + moment(date).subtract(2, 'quarters').quarter()
    const name = 'Groupm ' + quarter + '-2025 APPROACH-C (A&B Combined)'
    const orderType = 'Contract'
    const lastControlBefore = 12
    const criteria = [{ type: 'Company', value: 'FNFCxMgEEr', op: 'include' }]
    await Parse.Cloud.run('control-create', { name, criteria, startQuarter, orderType, lastControlBefore, date, dueDate, startedBefore, untilDate }, { useMasterKey: true })
  }
})
