const { setCubeOrderStatuses } = require('@/shared')

Parse.Cloud.define('manual-updates-set-cube-statuses', ({ params: { orderClass, orderId } }) => {
  return $getOrFail(orderClass, orderId).then(setCubeOrderStatuses)
}, { requireMaster: true })

// FEBRUARY FIX
Parse.Cloud.define('manual-updates-fix-februaries', async () => {
  const contracts = await $query('Contract').equalTo('endsAt', '2024-02-28').find({ useMasterKey: true })
  for (const contract of contracts) {
    contract.set('endsAt', '2024-02-29')
    await contract.save(null, { useMasterKey: true })
  }
  return contracts.length
})
// THEN RUN INVOICE UPDATES

// IF OVERLAPPING PLANNED INVOICES, DELETE MANUALLY
Parse.Cloud.define('manual-updates-check-contract-invoices', async () => {
  const allInvoices = await $query('Invoice')
    .notEqualTo('periodStart', null)
    .notEqualTo('periodEnd', null)
    .notEqualTo('media', null)
    .notEqualTo('contract', null)
    .notEqualTo('status', 3) // canceled
    .ascending('periodStart')
    .select('contract.no', 'contract.startsAt', 'contract.initialDuration', 'contract.extendedDuration', 'periodStart', 'periodEnd')
    .limit(10000)
    .find({ useMasterKey: true })
  const contracts = {}
  for (const invoice of allInvoices) {
    const contractNo = invoice.get('contract').get('no')
    if (!contracts[contractNo]) {
      const { startsAt, initialDuration, extendedDuration } = invoice.get('contract').attributes
      const endsAt = moment(startsAt).add(initialDuration, 'months').add(extendedDuration, 'months').subtract(1, 'day').format('YYYY-MM-DD')
      contracts[contractNo] = { startsAt, endsAt, periods: [] }
    }
    const start = invoice.get('periodStart')
    const end = invoice.get('periodEnd')
    contracts[contractNo].periods.push([start, end])
  }
  const contractNos = Object.keys(contracts)
  for (const contractNo of contractNos) {
    const errors = []
    const { startsAt, endsAt, periods } = contracts[contractNo]
    let nextStart
    let finalEnd
    for (const [start, end] of periods) {
      if (nextStart && start !== nextStart) {
        errors.push({ periods })
      }
      nextStart = moment(end).add(1, 'day').format('YYYY-MM-DD')
      finalEnd = end
    }
    if (finalEnd !== endsAt) {
      errors.push({ finalEnd })
    }
    if (!errors.length) {
      delete contracts[contractNo]
      continue
    }
    contracts[contractNo] = { startsAt, endsAt, errors }
  }
  return contracts
}, { requireMaster: true })

Parse.Cloud.define('manual-updates-check-end-dates', async () => {
  const allRunningContracts = await $query('Contract')
    .equalTo('canceledAt', null)
    .select(['no', 'startsAt', 'initialDuration', 'extendedDuration', 'endsAt'])
    .limit(1000)
    .find({ useMasterKey: true })
  const response = {}
  for (const contract of allRunningContracts) {
    const { no, startsAt, initialDuration, extendedDuration, endsAt } = contract.attributes
    const shouldEndAt = moment(startsAt).add(initialDuration, 'months').add(extendedDuration || 0, 'months').subtract(1, 'day').format('YYYY-MM-DD')
    if (shouldEndAt !== endsAt) {
      response[no] = { startsAt, endsAt, shouldEndAt }
    }
  }
  return response
}, { requireMaster: true })
