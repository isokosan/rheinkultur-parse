require('./run')(async () => {
  for (const quarter of [
    'Q2',
    'Q3',
    'Q4'
  ]) {
    const date = moment().quarter(quarter.slice(1)).startOf('quarter').format('YYYY-MM-DD')
    const dueDate = moment(date).endOf('quarter').format('YYYY-MM-DD')
    const untilDate = moment(dueDate).add(1, 'month').format('YYYY-MM-DD')
    const startQuarter = 'Q' + moment(date).subtract(2, 'quarters').quarter()
    const name = 'Groupm ' + quarter + '-2024 StartQ:' + startQuarter
    const orderType = 'Contract'
    const criteria = [{ type: 'Company', value: 'FNFCxMgEEr', op: 'include' }]
    await Parse.Cloud.run('control-create', { name, criteria, startQuarter, orderType, date, dueDate, untilDate }, { useMasterKey: true })
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
    const startQuarter = 'Q' + moment(date).subtract(2, 'quarters').quarter()
    const name = 'Groupm ' + quarter + '-2025 StartQ:' + startQuarter
    const orderType = 'Contract'
    const criteria = [{ type: 'Company', value: 'FNFCxMgEEr', op: 'include' }]
    await Parse.Cloud.run('control-create', { name, criteria, startQuarter, orderType, date, dueDate, untilDate }, { useMasterKey: true })
  }
})
