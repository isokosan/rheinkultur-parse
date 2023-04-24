Parse.Cloud.define('manual-updates-clean-audits', async ({ params: { preview } }) => {
  let i = 0
  await $query('Audit').notEqualTo('data.changes', null).select(['fn', 'data']).each(async (audit) => {
    const data = audit.get('data')
    let changed = false
    for (const key of Object.keys(data.changes)) {
      const [before, after] = data.changes[key]
      if (before === after) {
        delete data.changes[key]
        changed = true
      }
    }
    if (changed) {
      if (!Object.keys(data.changes).length) {
        delete data.changes
      }
      if (preview) {
        consola.info(audit.get('fn'), audit.get('data'), data)
      } else {
        Object.keys(data).length
          ? await audit.set({ data }).save(null, { useMasterKey: true })
          : await audit.destroy({ useMasterKey: true })
      }
      i++
    }
  }, { useMasterKey: true })
  return i
}, { requireMaster: true })

// CHECK OVERLAPPING PLANNED INVOICES OF CONTRACTS
Parse.Cloud.define('manual-updates-check-contract-invoices', async () => {
  const allInvoices = await $query('Invoice')
    .notEqualTo('periodStart', null)
    .notEqualTo('periodEnd', null)
    .notEqualTo('media', null)
    .notEqualTo('contract', null)
    .notContainedIn('status', [3, 4]) // canceled
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
    const ends = []
    for (const [start, end] of periods) {
      if (nextStart && start !== nextStart) {
        errors.push({ periods })
      }
      nextStart = moment(end).add(1, 'day').format('YYYY-MM-DD')
      finalEnd = end
      if (ends.includes(end)) {
        errors.push({ duplicateEnd: end })
      }
      ends.push(end)
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

// CHECK END DATES OF NON-CANCELED CONTRACTS
Parse.Cloud.define('manual-updates-check-end-dates', async () => {
  const contracts = await $query('Contract')
    .equalTo('canceledAt', null)
    .select(['no', 'startsAt', 'initialDuration', 'extendedDuration', 'endsAt'])
    .limit(1000)
    .find({ useMasterKey: true })
  const response = {}
  for (const contract of contracts) {
    const { no, startsAt, endsAt } = contract.attributes
    const shouldEndAt = moment(startsAt)
      .add(contract.get('initialDuration'), 'months')
      .add(contract.get('extendedDuration') || 0, 'months')
      .subtract(1, 'day')
      .format('YYYY-MM-DD')
    if (shouldEndAt !== endsAt) {
      response[no] = { startsAt, endsAt, shouldEndAt }
    }
  }
  return response
}, { requireMaster: true })

// CHECK END DATES OF CANCELED CONTRACTS
Parse.Cloud.define('manual-updates-check-canceled-end-dates', async () => {
  const contracts = await $query('Contract')
    .notEqualTo('canceledAt', null)
    .limit(1000)
    .find({ useMasterKey: true })
  const response = {}
  for (const contract of contracts) {
    const endsAt = contract.get('endsAt')
    const shouldEndAt = moment(contract.get('startsAt'))
      .add(contract.get('initialDuration'), 'months')
      .add(contract.get('extendedDuration') || 0, 'months')
      .subtract(1, 'day')
      .format('YYYY-MM-DD')
    if (shouldEndAt === endsAt) {
      consola.info(contract.get('no'))
      continue
    }
    response[contract.get('no')] = {
      endsAt: shouldEndAt,
      newEndsAt: endsAt
    }
  }
  return response
}, { requireMaster: true })
