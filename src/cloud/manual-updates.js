// FIRST KINETIC CONTROL
async function getFirstKineticControlContractIds () {
  const nos = [
    '20-0310',
    '20-0311',
    '20-0312',
    '21-0447',
    '21-0464',
    '21-0465',
    '21-0466',
    '21-0531',
    '21-0560',
    '21-0626',
    '21-0631',
    '21-0765',
    '21-0789',
    '21-0830',
    '21-0831',
    '21-0855',
    '21-0856',
    '21-0857',
    '21-0864',
    '21-0866',
    '21-0867',
    '21-0868',
    '21-0880',
    '21-0881',
    '21-0897',
    '21-0960',
    '21-0970',
    '21-0971',
    '22-0017',
    '22-0018',
    '22-0019',
    '22-0021',
    '22-0030',
    '22-0031',
    '22-0033',
    '22-0072',
    '22-0073',
    '22-0075',
    '22-0076',
    '22-0077',
    '22-0088',
    '22-0092',
    '22-0113',
    '22-0114',
    '22-0130',
    '22-0142',
    '22-0153',
    '22-0154',
    '22-0165',
    '22-0176',
    '22-0203',
    '22-0204',
    '22-0211',
    '22-0223',
    '22-0224',
    '22-0225',
    '22-0226',
    '22-0227',
    '22-0318',
    '22-0319',
    '22-0349',
    '22-0350',
    '22-0351',
    '22-0355',
    '22-0376',
    '22-0377',
    '22-0402',
    '22-0405',
    '22-0425',
    '22-0426',
    '22-0429',
    '22-0430',
    '22-0432',
    '22-0436',
    '22-0437',
    '22-0468',
    '22-0486',
    '22-0487',
    '22-0493',
    '22-0497',
    '22-0498',
    '22-0499',
    '22-0500',
    '22-0512',
    '22-0514',
    '22-0551',
    '22-0552',
    '22-0595',
    '22-0597',
    '22-0616',
    '22-0620',
    '22-0624',
    '22-0625',
    '22-0626',
    '22-0627',
    '22-0629',
    '22-0630',
    '22-0675',
    '22-0701',
    '22-0723',
    '22-0725',
    '22-0745',
    '22-0746',
    '22-0747',
    '22-0749',
    '22-0751',
    '22-0752',
    '22-0753',
    '22-0754',
    '22-0755',
    '22-0756',
    '22-0757',
    '22-0758',
    '22-0765',
    '22-0768',
    '22-0834',
    '22-0835',
    '22-0838',
    '22-0844',
    '22-0861',
    '22-0862',
    '22-0890',
    '22-0891',
    '22-0892',
    '22-0905',
    '22-0906',
    '22-0907',
    '22-0985',
    '22-0986',
    '22-0987',
    '22-0988',
    '22-0989',
    '22-0990',
    '22-0991',
    '22-0992',
    '22-1007'
  ]
  return $query('Contract').containedIn('no', nos.map(no => 'V' + no)).distinct('objectId', { useMasterKey: true })
}

Parse.Cloud.define('manual-updates-initialize-controls', async () => {
  const control = {
    name: 'Kinetic 04-2023',
    date: '2023-04-01',
    lastControlBefore: 0,
    criteria: await getFirstKineticControlContractIds()
      .then(ids => ids.map((id) => ({
        type: 'Contract',
        value: id,
        op: 'include'
      })))
  }
  return Parse.Cloud.run('control-create', control, { useMasterKey: true })
}, { requireMaster: true })
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
