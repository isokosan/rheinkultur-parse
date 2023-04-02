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
}, { requireMaster: true })

Parse.Cloud.define('manual-updates-credit-note-periods', async () => {
  let i = 0
  // add missing periods
  const missingGtVon = await $query('CreditNote').contains('introduction', 'Gutschriftzeitraum: von').equalTo('periodStart', null).find({ useMasterKey: true })
  for (const item of missingGtVon) {
    const introduction = item.get('introduction')
    consola.info(introduction)
    let [, periodStart, periodEnd] = introduction.match(/Gutschriftzeitraum: von (\d{2}\.\d{2}\.\d{4}) bis (\d{2}\.\d{2}\.\d{4})/)
    periodStart = moment(periodStart, 'DD.MM.YYYY').format('YYYY-MM-DD')
    periodEnd = moment(periodEnd, 'DD.MM.YYYY').format('YYYY-MM-DD')
    await item.set({ periodStart, periodEnd }).save(null, { useMasterKey: true })
    i++
  }

  const missingGt = await $query('CreditNote').contains('introduction', 'Gutschriftzeitraum').equalTo('periodStart', null).find({ useMasterKey: true })
  for (const item of missingGt) {
    const introduction = item.get('introduction')
    consola.info(introduction)
    let [, periodStart, periodEnd] = introduction.match(/Gutschriftzeitraum: (\d{2}\.\d{2}\.\d{4}) bis (\d{2}\.\d{2}\.\d{4})/)
    periodStart = moment(periodStart, 'DD.MM.YYYY').format('YYYY-MM-DD')
    periodEnd = moment(periodEnd, 'DD.MM.YYYY').format('YYYY-MM-DD')
    await item.set({ periodStart, periodEnd }).save(null, { useMasterKey: true })
    i++
  }

  const missingGts = await $query('CreditNote').contains('introduction', 'Gutschriftszeitraum').equalTo('periodStart', null).find({ useMasterKey: true })
  for (const item of missingGts) {
    const introduction = item.get('introduction')
    let [, periodStart, periodEnd] = introduction.match(/Gutschriftszeitraum: von (\d{2}\.\d{2}\.\d{4}) bis (\d{2}\.\d{2}\.\d{4})/)
    periodStart = moment(periodStart, 'DD.MM.YYYY').format('YYYY-MM-DD')
    periodEnd = moment(periodEnd, 'DD.MM.YYYY').format('YYYY-MM-DD')
    await item.set({ periodStart, periodEnd }).save(null, { useMasterKey: true })
    i++
  }

  return i
})
// Parse.Cloud.run('manual-updates-credit-note-periods', null, { useMasterKey: true }).then(consola.info)

// Required invoice linking for media forms
Parse.Cloud.define('manual-updates-credit-note-invoices', async () => {
  let i = 0
  const creditNotes = await $query('CreditNote').equalTo('invoices', null).notEqualTo('invoice', null).find({ useMasterKey: true })
  for (const note of creditNotes) {
    note.set('invoices', [note.get('invoice')])
    await note.save(null, { useMasterKey: true })
    i++
  }

  const updates = [
    ['GS23-00038', ['RE23-00502']],
    ['GS23-00039', ['RE23-00406']],
    ['GS23-00040', ['RE23-00197']],
    ['GS23-00067', ['RE23-00511', 'RE23-00601']],
    ['GS23-00085', ['RE23-00070']]
  ]

  for (const [gsNo, invoiceNos] of updates) {
    const creditNote = await $query('CreditNote').equalTo('lexNo', gsNo).first({ useMasterKey: true })
    if (!creditNote) { continue }
    const invoices = await $query('Invoice').containedIn('lexNo', invoiceNos).find({ useMasterKey: true })
    creditNote.set('invoices', invoices)
    await creditNote.save(null, { useMasterKey: true })
    i++
  }
  return i
})

// decide whether or not to include invoice data
Parse.Cloud.define('manual-updates-credit-note-medias', async () => {
  const hasLessorInvoicesQuery = $query('CreditNote').matchesQuery('invoices', $query('Invoice').notEqualTo('lessor', null))
  const hasNonZeroContractQuery = $query('CreditNote').matchesQuery('contract', $query('Contract').notEqualTo('pricingModel', 'zero'))
  const creditNotesQuery = Parse.Query.or(hasLessorInvoicesQuery, hasNonZeroContractQuery)
    .equalTo('status', 2)
    .equalTo('media', null)
    .notEqualTo('periodEnd', null)
    .notEqualTo('periodStart', null)
    .include(['company', 'contract', 'booking', 'bookings'])
  const mediaUpdates = {
    // all cubes canceled in period
    'GS23-00023': {
      'WmSH6aQXvC:TLK-2122A518': { start: '2023-01-01', end: '2023-01-31', total: 38 },
      'WmSH6aQXvC:TLK-2124A503': { start: '2023-01-01', end: '2023-01-31', total: 38 },
      'WmSH6aQXvC:TLK-2126A69': { start: '2023-01-01', end: '2023-01-31', total: 38 }
    },
    // all cubes canceled in period
    'GS23-00024': {
      'XrB4pfxaa0:TLK-2122A518': { start: '2023-02-01', end: '2023-02-28', total: 38 },
      'XrB4pfxaa0:TLK-2124A503': { start: '2023-02-01', end: '2023-02-28', total: 38 },
      'XrB4pfxaa0:TLK-2126A69': { start: '2023-02-01', end: '2023-02-28', total: 38 }
    },
    // cube partly canceled withing invoice period
    'GS23-00036': {
      'NjHquWKYwt:TLK-48632V1100': { start: '2023-01-17', end: '2023-03-31', total: 74.52 }
    },
    // one cube of many canceled within total period
    'GS23-00038': {
      '4u1IAkRopJ:TLK-45321A14': { start: '2023-02-01', end: '2023-03-31', total: 100 }
    },
    // early canceled cubes trifft one invoice
    'GS23-00039': {
      '7P24ZrsGx1:TLK-48632A14': { start: '2023-01-17', end: '2023-03-31', total: 63.05 },
      '7P24ZrsGx1:TLK-48632A6': { start: '2023-01-17', end: '2023-03-31', total: 105.09 },
      '7P24ZrsGx1:TLK-48633R512': { start: '2023-01-17', end: '2023-03-31', total: 105.09 }
    },
    // extra case that touches two previous periods, one without invoice!
    // ask for which cube the 98,45€ and which period it was calculated for
    'GS23-00040': {
      'w7rZfMeaYG:TLK-?': { start: '2022-11-01', end: '2023-01-18', total: 98.45 }
    },
    // wrong total within the period
    'GS23-00041': {
      '6GGsvagy5m:TLK-71525A36': { start: '2023-02-15', end: '2023-03-31', total: 1.83 },
      '6GGsvagy5m:TLK-71525A539': { start: '2023-02-15', end: '2023-03-31', total: 1.82 }
    },
    // partly canceled: Rückbau aufgrund einer Satzung der Stadt
    'GS23-00065': {
      'ImGX46hrSn:TLK-77251A27': { start: '2023-02-01', end: '2023-03-31', total: 76.30 }
    },
    // Vandalismus, 2 months of 3 canceled
    'GS23-00066': {
      'ZTEWAWp0OS:TLK-23751A5': { start: '2023-02-01', end: '2023-03-31', total: 76.30 }
    },
    // 2 invoices, early canceled cube!
    // TODO: Maybe combine? or maybe not...
    'GS23-00067': {
      'Sksc82Bu00:TLK-77217A46': { start: '2023-02-01', end: '2023-02-28', total: 37.50 },
      'gLjzuEfTxG:TLK-77217A46': { start: '2023-03-01', end: '2023-03-31', total: 37.50 }
    },
    // Yearly invoice, one cube one period affected
    'GS23-00085': {
      '2aDj3DEfAY:TLK-21291A50': { start: '2023-02-15', end: '2023-03-31', total: 65.63 }
    }
  }
  consola.info(mediaUpdates)
  return creditNotesQuery.find({ useMasterKey: true }).then(cns => cns.map(cn => cn.get('lexNo')))
}, { requireMaster: true })
// Parse.Cloud.run('manual-updates-credit-note-medias', null, { useMasterKey: true }).then(consola.info)

async function updateBookingExtends () {
  const autoExtendMap = require('@/seed/data/autovercsv.json').reduce((acc, row) => {
    const { no, e } = row
    acc[no] = e.toLowerCase().trim() === 'ja'
    return acc
  }, {})
  const shouldNotAutoExtend = Object.keys(autoExtendMap)
    .filter(no => !autoExtendMap[no])
    .map(no => 'B' + no)
  await $query('Booking')
    .notEqualTo('autoExtendsBy', null)
    .containedIn('no', shouldNotAutoExtend)
    .each(async (booking) => {
      const autoExtendsBy = null
      const autoExtendsAt = null
      const changes = $changes(booking, { autoExtendsBy })
      const audit = { fn: 'booking-update', data: { changes } }
      await booking.set({ autoExtendsBy, autoExtendsAt }).save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
      consola.success('ok', booking.get('no'))
    }, { useMasterKey: true })
}

Parse.Cloud.define('manual-update-booking-extends', async () => {
  updateBookingExtends()
  return 'ok'
}, { requireMaster: true })
