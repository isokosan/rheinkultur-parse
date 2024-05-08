global.Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)

require('./../globals')
const { getQuarterStartEnd, getCubeSummaries } = require('./../shared')
const { round2 } = require('./../utils')
const {
  getOrCacheRegionalCommissions,
  getOrCacheLessorCommissions,
  processMediaInvoices,
  mapReportRow
} = require('./../report-helpers')

// Pachtrelevant without contract
async function processCustomInvoices (start, end) {
  const response = []
  const invoicesQuery = $query('Invoice')
    .greaterThanOrEqualTo('status', 1)
    .lessThanOrEqualTo('status', 2)
    .equalTo('media', null)
    .notEqualTo('lessor', null)
    .greaterThan('periodEnd', start)
    .lessThanOrEqualTo('periodStart', end)
  let i = 0
  await invoicesQuery
    .include(['company', 'lessor'])
    .skip(i)
    .each((invoice) => {
      consola.warn('Custom Invoice', invoice.get('lexNo'))
      const row = {
        voucherNos: invoice.get('lexNo'),
        lc: invoice.get('lessor').get('lessor').code,
        companyId: invoice.get('company').id,
        companyName: invoice.get('company').get('name'),
        start: invoice.get('periodStart'),
        end: invoice.get('periodEnd')
      }
      row.periodStart = row.start > start ? row.start : start
      row.periodEnd = row.end < end ? row.end : end
      const duration = moment(row.end).add(1, 'days').diff(moment(row.start), 'months', true)
      const months = moment(row.periodEnd).add(1, 'days').diff(moment(row.periodStart), 'months', true)
      row.total = invoice.get('netTotal') || 0
      row.duration = round2(duration)
      row.months = months
      row.extraCols = invoice.get('extraCols')
      response.push(row)
      i++
    }, { useMasterKey: true })
  consola.info(`Processed ${i} custom invoices`)
  return response
}

async function processCreditNotes (start, end) {
  const response = []
  let i = 0
  const creditNotesQuery = $query('CreditNote')
    .equalTo('status', 2)
    .notEqualTo('mediaItems', null)
    .greaterThan('periodEnd', start)
    .lessThanOrEqualTo('periodStart', end)
    .include(['company', 'contract', 'booking'])
  await creditNotesQuery.each(async (creditNote) => {
    const mediaItems = creditNote.get('mediaItems')
    const cubeIds = []
    const invoiceIds = []
    for (const [invoiceId, cubeId] of Object.keys(mediaItems).map(key => key.split(':'))) {
      !invoiceIds.includes(invoiceId) && invoiceIds.push(invoiceId)
      cubeId && !cubeIds.includes(cubeId) && cubeIds.push(cubeId)
    }

    const cubeSummaries = await getCubeSummaries(cubeIds)
    const invoices = await $query('Invoice')
      .containedIn('objectId', invoiceIds)
      .limit(invoiceIds.length)
      .include('lessor')
      .find({ useMasterKey: true })
    const contract = creditNote.get('contract')
    for (const key of Object.keys(mediaItems)) {
      const [invoiceId, cubeId] = key.split(':')
      const mediaItem = mediaItems[key]
      // credit note period might span a longer time than a quarter, so make sure the cube end is within the start-end period
      // const cubePeriodEnd = mediaItem.periodEnd < invoicePeriodEnd ? mediaItem.periodEnd : invoicePeriodEnd
      // if (cubePeriodEnd < periodStart) { continue }
      // make sure to recalculate months for the quarter
      // const months = moment(cubePeriodEnd).add(1, 'days').diff(moment(periodStart), 'months', true)
      const invoice = invoices.find(invoice => invoice.id === invoiceId)
      const agencyId = invoice.get('agency')?.id
      const agencyRate = invoice.get('commissionRate') || 0
      const cubeOrLessorInfo = cubeId ? cubeSummaries[cubeId] : { lc: invoice.get('lessor').get('lessor').code, lessorRate: invoice.get('lessorRate') }
      const row = {
        voucherNos: [creditNote.get('lexNo'), invoice.get('lexNo')].join(', '),
        orderNo: contract?.get('no'),
        ...cubeOrLessorInfo,
        periodStart: mediaItem.start,
        periodEnd: mediaItem.end,
        total: mediaItem.total * -1
      }
      row.companyId = creditNote.get('company').id
      row.companyName = creditNote.get('company')?.get('name')
      if (contract) {
        const { startsAt, endsAt, initialDuration, extendedDuration } = contract.attributes
        row.start = startsAt
        row.end = endsAt
        row.duration = initialDuration
        if (extendedDuration) {
          row.duration += `+${extendedDuration}`
        }
      }

      // apply agency artes
      row.monthlyNet = row.monthly
      if (agencyId) {
        row.agencyId = agencyId
        row.agencyRate = agencyRate
      }

      row.motive = contract?.get('motive')
      row.externalOrderNo = contract?.get('externalOrderNo')
      row.campaignNo = contract?.get('campaignNo')
      row.extraCols = invoice.get('extraCols')
      response.push(row)
    }
    i++
  }, { useMasterKey: true })
  consola.info(`Processed ${i} media credit notes`)
  return response
}

async function processPartnerQuarters (quarter) {
  const response = []
  await $query('PartnerQuarter')
    .equalTo('quarter', quarter)
    .include(['rows', 'company'])
    .each((partnerQuarter) => {
      const companyName = partnerQuarter.get('company').get('name')
      response.push(...(partnerQuarter.get('rows') || []).map(row => ({
        ...row,
        companyName
      })))
    }, { useMasterKey: true })
  return response
}

// Kinetic, Here & Now etc.
async function processCustomContracts (start, end) {
  const response = []
  let i = 0
  while (true) {
    const contracts = await $query('Contract')
      .greaterThanOrEqualTo('status', 3) // active, canceled or ended
      .greaterThan('endsAt', start)
      .lessThanOrEqualTo('startsAt', end)
      .equalTo('pricingModel', 'zero')
      .include(['company'])
      .skip(i)
      .find({ useMasterKey: true })
    if (!contracts.length) { break }
    for (const contract of contracts) {
      const periodStart = contract.get('startsAt') > start
        ? contract.get('startsAt')
        : start
      const periodEnd = contract.get('endsAt') < end
        ? contract.get('endsAt')
        : end
      const earlyCancellations = contract.get('earlyCancellations') || {}

      const cubeSummaries = await getCubeSummaries(contract.get('cubeIds'))
      for (const cubeSummary of Object.values(cubeSummaries)) {
        const cubeCanceledAt = earlyCancellations[cubeSummary.objectId]
        // if cube is canceledEarly, and the early cancelation is before periodStart, skip
        if (cubeCanceledAt && (cubeCanceledAt === true || cubeCanceledAt < periodStart)) {
          continue
        }

        const cubePeriodEnd = cubeCanceledAt && cubeCanceledAt < periodEnd ? cubeCanceledAt : periodEnd

        const row = {
          orderNo: contract.get('no'),
          companyId: contract.get('company').id,
          companyName: contract.get('company').get('name'),
          ...cubeSummary,
          periodStart,
          periodEnd: cubePeriodEnd,
          monthly: 0,
          months: moment(cubePeriodEnd).add(1, 'days').diff(periodStart, 'months', true)
        }

        const { startsAt, endsAt, initialDuration, extendedDuration } = contract.attributes
        row.start = startsAt
        row.end = endsAt
        row.duration = initialDuration
        if (extendedDuration) {
          row.duration += `+${extendedDuration}`
        }
        // check early cancel
        if (cubeCanceledAt && cubeCanceledAt < endsAt) {
          row.end = cubeCanceledAt
          row.duration = moment(cubeCanceledAt).diff(startsAt, 'months', true)
        }

        row.motive = contract.get('motive')
        row.externalOrderNo = contract.get('externalOrderNo')
        row.campaignNo = contract.get('campaignNo')
        response.push(row)
      }
    }
    i += contracts.length
  }
  consola.info(`Processed ${i} zero contracts`)
  return response
}

async function processOccupiedCubes (start, end) {
  const response = []
  const PG = await $query('Cube')
    .equalTo('flags', 'PG')
    .equalTo('order', null)
    .distinct('objectId', { useMasterKey: true })
  const PGCubeSummaries = await getCubeSummaries(PG)
  for (const cubeSummary of Object.values(PGCubeSummaries)) {
    const row = {
      ...cubeSummary
    }
    row.motive = 'Privates Grundstück'
    response.push(row)
  }
  consola.info(`Processed ${PG.length} PG cubes`)

  const Agwb = await $query('Cube')
    .equalTo('flags', 'Agwb')
    .equalTo('order', null)
    .distinct('objectId', { useMasterKey: true })
  const AgwbCubeSummaries = await getCubeSummaries(Agwb)
  for (const cubeSummary of Object.values(AgwbCubeSummaries)) {
    const row = {
      ...cubeSummary
    }
    row.motive = 'Malation (Aus grau wird bunt)'
    response.push(row)
  }
  consola.info(`Processed ${Agwb.length} Agwb cubes`)
  return response
}

module.exports = async function (job) {
  const startedAt = moment()
  const { id } = job.data
  job.progress('Bericht wird generiert...')
  const quarterlyReport = await $getOrFail('QuarterlyReport', id)
  const quarter = quarterlyReport.get('quarter')

  if (quarterlyReport.get('status') === 'finalized') {
    throw new Error('This report has been finalized.')
  }

  await getOrCacheRegionalCommissions(true)
  await getOrCacheLessorCommissions(true)

  quarterlyReport.set('status', 'generating').set('jobId', job.id).save(null, { useMasterKey: true })
  job.progress('Quartalsdaten werden geladen...')
  const { start, end } = getQuarterStartEnd(quarter)
  job.progress('Pachtrelevant Rechnungen werden verarbeitet...')
  const mediaInvoices = await processMediaInvoices(start, end)
  const customInvoices = await processCustomInvoices(start, end)
  job.progress('Vertriebspartner Quartale werden verarbeitet...')
  const partnerBookings = await processPartnerQuarters(quarter)
  job.progress('Fullservicepreis/Geschenke Verträge werden verarbeitet...')
  const zeroContracts = await processCustomContracts(start, end)
  job.progress('Ausschlusskritierien werden verarbeitet...')
  const occupiedCubes = await processOccupiedCubes(start, end)
  job.progress('Pachtrelevant Gutschriften werden verarbeitet...')
  const creditNotes = await processCreditNotes(start, end)
  job.progress('Daten werden formatiert...')
  const rows = await Promise.all([
    ...mediaInvoices,
    ...customInvoices,
    ...partnerBookings,
    ...zeroContracts,
    ...occupiedCubes,
    ...creditNotes
  ].map(mapReportRow))
  rows.sort((a, b) => {
    if (a.orderNo && !b.orderNo) { return -1 }
    if (!a.orderNo && b.orderNo) { return 1 }
    return a.orderNo < b.orderNo ? -1 : 1
  })

  const rheinkultur = { total: 0, totalNet: 0, cubes: 0, orders: {} }
  const customers = {}
  const distributors = {}
  const agencies = {}
  const regionals = {}
  for (const region of await getOrCacheRegionalCommissions()) {
    regionals[region.regionId] = {
      regionId: region.regionId,
      name: region.name,
      total: 0,
      cubes: 0,
      orders: {}
    }
  }
  const lessors = {}
  for (const lessor of await getOrCacheLessorCommissions().then(Object.values)) {
    lessors[lessor.code] = {
      lessorCode: lessor.code,
      total: 0,
      cubes: 0,
      orders: {}
    }
  }

  for (const row of rows) {
    rheinkultur.total = round2(rheinkultur.total + row.total || 0)
    rheinkultur.totalNet = round2(rheinkultur.totalNet + row.totalNet || 0)
    row.objectId && rheinkultur.cubes++
    row.orderNo && (rheinkultur.orders[row.orderNo] = true)

    const { distributorId, agencyId, regionId, lc: lessorCode } = row
    if (distributorId) {
      if (!distributors[distributorId]) {
        distributors[distributorId] = {
          distributorId,
          total: 0,
          cubes: 0,
          orders: {}
        }
      }
      distributors[distributorId].total = round2(distributors[distributorId].total + (row.total || 0))
      row.objectId && distributors[distributorId].cubes++
      row.orderNo && (distributors[distributorId].orders[row.orderNo] = true)
    }
    if (agencyId) {
      if (!agencies[agencyId]) {
        agencies[agencyId] = {
          agencyId,
          total: 0,
          cubes: 0,
          orders: {}
        }
      }
      agencies[agencyId].total = round2(agencies[agencyId].total + (row.agencyTotal || 0))
      row.objectId && agencies[agencyId].cubes++
      row.orderNo && (agencies[agencyId].orders[row.orderNo] = true)
    }
    if (regionId) {
      regionals[regionId].total = round2(regionals[regionId].total + (row.regionalTotal || 0))
      row.objectId && regionals[regionId].cubes++
      row.orderNo && (regionals[regionId].orders[row.orderNo] = true)
    }
    if (lessorCode) {
      lessors[lessorCode].total = round2(lessors[lessorCode].total + (row.lessorTotal || 0))
      row.objectId && lessors[lessorCode].cubes++
      row.orderNo && (lessors[lessorCode].orders[row.orderNo] = true)
    }
  }

  job.progress('Bericht wird gespeichert...')
  rheinkultur.orders = Object.keys(rheinkultur.orders).length
  for (const distributorId in distributors) {
    distributors[distributorId].orders = Object.keys(distributors[distributorId].orders).length
  }
  for (const agencyId in agencies) {
    agencies[agencyId].orders = Object.keys(agencies[agencyId].orders).length
  }
  for (const regionId in regionals) {
    regionals[regionId].orders = Object.keys(regionals[regionId].orders).length
  }
  for (const lessorCode in lessors) {
    lessors[lessorCode].orders = Object.keys(lessors[lessorCode].orders).length
  }
  await quarterlyReport
    .set({
      status: 'draft',
      jobId: null,
      rheinkultur,
      customers,
      distributors,
      agencies,
      regionals,
      lessors,
      rows
    }).save(null, { useMasterKey: true })
  const took = moment().diff(startedAt, 'seconds')
  return Promise.resolve({ took })
}
