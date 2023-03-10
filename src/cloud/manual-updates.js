const { setCubeOrderStatuses } = require('@/shared')

Parse.Cloud.define('manual-updates-set-cube-statuses', ({ params: { orderClass, orderId } }) => {
  return $getOrFail(orderClass, orderId).then(setCubeOrderStatuses)
}, { requireMaster: true })

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

Parse.Cloud.define('manual-updates-clean-audits', async () => {
  let skip = 0
  let i = 0
  while (true) {
    const audits = await $query('Audit').notEqualTo('data.changes', null).select('data').skip(skip).limit(1000).find({ useMasterKey: true })
    if (!audits.length) { break }
    for (const audit of audits) {
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
        Object.keys(data).length
          ? await audit.set({ data }).save(null, { useMasterKey: true })
          : await audit.destroy({ useMasterKey: true })
        i++
      }
    }
    skip += audits.length
  }
  return i
}, { requireMaster: true })

Parse.Cloud.define('manual-updates-canceled', async () => {
  const response = {}
  const contracts = await $query('Contract').notEqualTo('canceledAt', null).limit(1000).find({ useMasterKey: true })
  for (const contract of contracts) {
    const endsAt = contract.get('endsAt')
    const shouldEndAt = moment(contract.get('startsAt'))
      .add(contract.get('initialDuration'), 'months')
      .add(contract.get('extendedDuration') || 0, 'months')
      .subtract(1, 'day')
      .format('YYYY-MM-DD')
    let newEndsAt
    if (endsAt !== shouldEndAt) {
      newEndsAt = endsAt
    }
    response[contract.get('no')] = newEndsAt || shouldEndAt
  }
  return response
})

DEVELOPMENT && Parse.Cloud.define('update-lex-addresses-dev', async () => {
  return $query('Address').notEqualTo('lex', null).each(async (address) => {
    // check if address name exists on lexoffice
    let [lex] = await Parse.Cloud.run('lex-contacts', { name: address.get('name') }, { useMasterKey: true })
    if (!lex) {
      lex = await Parse.Cloud.run('lex-contact-create', {
        name: address.get('name'),
        allowTaxFreeInvoices: address.get('countryCode') !== 'DE' || undefined
      }, { useMasterKey: true })
      consola.info('created new lex', address.get('name'))
    } else {
      consola.success('found lex', address.get('name'))
    }
    return address.set({ lex }).save(null, { useMasterKey: true })
  }, { useMasterKey: true })
}, { requireMaster: true })

// async function prepareDisassemblyControls() {
//   const all = require('@/seed/data/disassembly_control.json')
//   const bookingCompanies = await $query('Booking').select('company').distinct('company', { useMasterKey: true })
//     .then(companies => Promise.all(companies.map(c => $getOrFail('Company', c.objectId))))
//     .then(companies => companies.map(c => c.get('importNo')))
//   function normalizeNo(row) {
//     const no = row.no
//     const importNo = parseInt(row['KD-Nr.'])
//     if (no[0] === 'B' || no[0] === 'V') {
//       return no
//     }
//     if (bookingCompanies.includes(importNo)) {
//       return 'B' + no
//     }
//     return 'V' + no
//   }
//   function normalizeDisassembly(disassembly) {
//     disassembly = disassembly.toLowerCase()
//     return disassembly = disassembly === 'ja'
//   }
//   const disassemblies = {}
//   for (const row of all) {
//     const no = normalizeNo(row)
//     const disassembly = normalizeDisassembly(row.dis)
//     if (no in disassemblies) {
//       if (disassemblies[no] !== disassembly) {
//         throw new Error('Mismatch: ' + no)
//       }
//     }
//     disassemblies[no] = disassembly
//   }
//   const fs = require('fs')
//   return fs.writeFileSync('./prepared_disassemblies.json', JSON.stringify(disassemblies, null, 2))
// }
// prepareDisassemblyControls()

async function fixDisassemblies () {
  const disassemblies = require('@/seed/data/prepared_disassemblies.json')
  const bookings = await $query('Booking').select(['no', 'disassembly']).limit(10000).find({ useMasterKey: true })
  const contracts = await $query('Contract').select(['no', 'disassembly']).limit(10000).find({ useMasterKey: true })
  for (const no of Object.keys(disassemblies)) {
    if (no.startsWith('B')) {
      const booking = bookings.find(booking => booking.get('no') === no)
      if (!booking || Boolean(booking.get('disassembly')) === disassemblies[no]) {
        delete disassemblies[no]
        continue
      }
      disassemblies[no] = {
        className: 'Booking',
        id: booking.id,
        current: Boolean(booking.get('disassembly')),
        expected: disassemblies[no]
      }
      continue
    }
    if (no.startsWith('V')) {
      const contract = contracts.find(contract => contract.get('no') === no)
      if (!contract || Boolean(contract.get('disassembly')) === disassemblies[no]) {
        delete disassemblies[no]
        continue
      }
      disassemblies[no] = {
        className: 'Contract',
        id: contract.id,
        current: Boolean(contract.get('disassembly')),
        expected: disassemblies[no]
      }
      continue
    }
    delete disassemblies[no]
  }
  let i = 0
  for (const { className, id, expected } of Object.values(disassemblies)) {
    await Parse.Cloud.run('disassembly-order-update', { className, id, disassembly: expected }, { useMasterKey: true })
    i++
  }
  return i
}

Parse.Cloud.define('fix-disassemblies', fixDisassemblies, { requireMaster: true })
