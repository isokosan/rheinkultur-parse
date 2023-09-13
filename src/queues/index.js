global.Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)

require('./../globals')
const { getQuarterStartEnd, getCubeSummaries } = require('./../shared')
const { round2, round5 } = require('./../utils')

async function processMediaInvoices (start, end) {
  const response = []
  let i = 0
  const invoiceMediaRows = {}
  const invoicesQuery = Parse.Query.or(
    $query('Invoice').equalTo('status', 2),
    // Include canceled vaillant 2023 invoice in every case during 2023 quarterly reports
    $query('Invoice').equalTo('objectId', 'qxOV3RIM2V').equalTo('status', 3)
  )
    .notEqualTo('media', null)
    .greaterThan('periodEnd', start)
    .lessThanOrEqualTo('periodStart', end)
    .include(['company', 'contract', 'booking', 'bookings'])
  await invoicesQuery.each(async (invoice) => {
    const periodStart = invoice.get('periodStart') > start
      ? invoice.get('periodStart')
      : start
    const invoicePeriodEnd = invoice.get('periodEnd') < end
      ? invoice.get('periodEnd')
      : end

    // agency commission rate
    const agencyId = invoice.get('agency')?.id
    const agencyRate = invoice.get('commissionRate') || 0

    const mediaItems = invoice.get('media')?.items || []
    const cubeIds = mediaItems.map(mediaItem => mediaItem.cubeId)
    const cubeSummaries = await getCubeSummaries(cubeIds)
    for (const mediaItem of mediaItems) {
      const cubeId = mediaItem.cubeId
      delete mediaItem.cubeId
      delete mediaItem.total // will be recalculated afterwards
      const cubeSummary = cubeSummaries[cubeId]
      // invoice might span a longer time than a quarter, so make sure the cube end is within the start-end period
      const cubePeriodEnd = mediaItem.periodEnd < invoicePeriodEnd ? mediaItem.periodEnd : invoicePeriodEnd
      if (cubePeriodEnd < periodStart) { continue }
      // make sure to recalculate months for the quarter
      const months = moment(cubePeriodEnd).add(1, 'days').diff(moment(periodStart), 'months', true)

      const contract = invoice.get('contract')
      const row = {
        voucherNos: invoice.get('lexNo'),
        orderNo: contract.get('no'),
        ...cubeSummary,
        ...mediaItem,
        periodStart,
        periodEnd: cubePeriodEnd,
        months
      }
      row.companyId = invoice.get('company').id
      row.companyName = invoice.get('company')?.get('name')
      if (contract) {
        const { startsAt, endsAt, initialDuration, extendedDuration } = contract.attributes
        row.start = startsAt
        row.end = endsAt
        row.duration = initialDuration
        if (extendedDuration) {
          row.duration += `+${extendedDuration}`
        }
        // check early cancel
        const cubeCanceledAt = contract.get('earlyCancellations')?.[cubeId]
        if (cubeCanceledAt === true) { continue }
        if (cubeCanceledAt && cubeCanceledAt < endsAt) {
          row.end = cubeCanceledAt
          row.duration = moment(cubeCanceledAt).diff(startsAt, 'months', true)
        }
      }

      // apply agency artes
      row.monthlyNet = row.monthly
      if (agencyId) {
        row.agencyId = agencyId
        row.agencyRate = agencyRate
      }

      // TODO: check later
      row.motive = contract.get('motive')
      row.externalOrderNo = contract.get('externalOrderNo')
      row.campaignNo = contract.get('campaignNo')
      row.extraCols = invoice.get('extraCols')

      if (!invoiceMediaRows[cubeId]) {
        invoiceMediaRows[cubeId] = []
      }
      invoiceMediaRows[cubeId].push(row)
    }
    i++
  }, { useMasterKey: true })
  consola.info(`Processed ${i} media invoices`)

  // attempt to combine rows that can be combined from invoices
  // Sort and check if zeitraumend and next zeitraumstart end up. If so, add the two rows together, and repeat until there is no more matches
  // Then flatten and push to rows
  for (const cubeId of Object.keys(invoiceMediaRows)) {
    const lines = invoiceMediaRows[cubeId]
    lines.sort((a, b) => a.periodStart > b.periodStart ? 1 : -1)
    while (lines.length) {
      const row = lines.shift()
      while (lines.length) {
        // Check if orderNo, agencyId, agencyId and monthly are the same
        if (lines[0].orderNo === row.orderNo && lines[0].agencyId === row.agencyId && lines[0].agencyRate === row.agencyRate && lines[0].monthly === row.monthly) {
          if (moment(lines[0].periodStart).isSame(moment(row.periodEnd).add(1, 'days'))) {
            const nextRow = lines.shift()
            row.periodEnd = nextRow.periodEnd
            row.months = round5(row.months + nextRow.months)
            row.voucherNos += `, ${nextRow.voucherNos}`
            continue
          }
        }
        break
      }
      response.push(row)
    }
  }
  return response
}

// Pachtrelevant without contract
async function processCustomInvoices (start, end) {
  const response = []
  const invoicesQuery = $query('Invoice')
    .equalTo('status', 2)
    .equalTo('media', null)
    .equalTo('periodicDistributorQuarter', null) // exclude periodic distributor invoices (MA Lionsgroup)
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
    .include(['company', 'contract', 'booking', 'bookings'])
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

      // TODO: check later
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

// TODO: Check Marc Asriel periodic invoice as row
async function processPartnerQuarters (quarter) {
  const response = []
  await $query('PartnerQuarter')
    .equalTo('quarter', quarter)
    .equalTo('status', 'finalized')
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
    .notEqualTo('PG', null)
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
    .notEqualTo('Agwb', null)
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

let REGIONAL_COMMISSIONS
async function getOrCacheRegionalCommissions () {
  if (!REGIONAL_COMMISSIONS) {
    const sksId = await $query('Company')
      .equalTo('name', 'Stadtkultur Stuttgart GmbH')
      .select('objectId')
      .first({ useMasterKey: true })
      .then(company => company.id)
    const skkId = await $query('Company')
      .equalTo('name', 'Stadtkultur GmbH')
      .select('objectId')
      .first({ useMasterKey: true })
      .then(company => company.id)
    const kineticId = await $query('Company')
      .equalTo('name', 'Kinetic Germany GmbH')
      .select('objectId')
      .first({ useMasterKey: true })
      .then(company => company.id)
    REGIONAL_COMMISSIONS = [
      {
        regionId: 'SKS',
        name: 'BW ohne Stadtgebiet Stuttgart (SKS)',
        rate: 7.5,
        rules: {
          lessorCode: 'TLK',
          includeStateIds: ['BW'],
          excludeOrt: 'Stuttgart',
          excludeCustomerIds: [sksId, skkId],
          excludeAgencyIds: [sksId, skkId]
        }
      },
      {
        regionId: 'SKK',
        name: 'BW Stadtgebiet Stuttgart (SKK)',
        rate: 7.5,
        rules: {
          lessorCode: 'TLK',
          includeStateIds: ['BW'],
          includeOrt: 'Stuttgart',
          excludeCustomerIds: [sksId, skkId],
          excludeAgencyIds: [sksId, skkId]
        }
      },
      {
        regionId: 'AACHEN',
        name: 'PDG Aachen',
        rate: 25,
        rules: {
          lessorCode: 'TLK',
          includeStateIds: ['NW'],
          includeOrts: [
            'Aachen',
            'Alsdorf',
            'Baesweiler',
            'Eschweiler',
            'Herzogenrath',
            'Monschau',
            'Roetgen',
            'Simmerath',
            'Stolberg',
            'Würselen'
          ],
          excludeCustomerIds: [kineticId]
        }
      }
    ]
  }
  return REGIONAL_COMMISSIONS
}

async function getRegionalCommissionRate ({ lc, stateId, ort, companyId, agencyId }) {
  await getOrCacheRegionalCommissions()
  for (const { regionId, rate, rules } of REGIONAL_COMMISSIONS) {
    if (rules.lc && lc !== rules.lc) { continue }
    if (rules.includeStateIds && !rules.includeStateIds.find(id => id === stateId)) { continue }
    if (rules.includeOrts && !rules.includeOrts.find(o => o === ort)) { continue }
    if (rules.includeOrt && rules.includeOrt !== ort) { continue }
    if (rules.excludeOrt && rules.excludeOrt === ort) { continue }
    if (rules.excludeCustomerIds && rules.excludeCustomerIds.find(id => id === companyId)) { continue }
    if (rules.excludeAgencyIds && rules.excludeAgencyIds.find(id => id === agencyId)) { continue }
    return { regionId, rate }
  }
  return null
}

let LESSOR_COMMISIONS
async function getOrCacheLessorCommissions () {
  if (!LESSOR_COMMISIONS) {
    const dict = {}
    const lessors = await $query('Company')
      .notEqualTo('lessor', null)
      .select('lessor')
      .find({ useMasterKey: true })
      .then(companies => companies.map(company => company.get('lessor')))
    for (const lessor of lessors) {
      const cityRates = {}
      const companyRates = {}
      for (const exceptionKey of Object.keys(lessor.exceptions || {})) {
        const exceptionArr = exceptionKey.split(':')
        if (exceptionArr[0] === 'city') {
          const cityKey = `${exceptionArr[1]}:${exceptionArr[2]}`
          cityRates[cityKey] = lessor.exceptions[exceptionKey]
          continue
        }
        if (exceptionArr[0] === 'companyId') {
          companyRates[exceptionArr[1]] = lessor.exceptions[exceptionKey]
          continue
        }
        throw new Error(`Unknown Exception Key: ${exceptionKey}`)
      }
      dict[lessor.code] = {
        code: lessor.code,
        rate: lessor.rate,
        cityRates,
        companyRates
      }
    }
    LESSOR_COMMISIONS = dict
  }
  return LESSOR_COMMISIONS
}

async function getLessorCommissionRate ({ lc, stateId, ort, companyId, lessorRate }) {
  // if lessorRate is already defined, return it directly
  if (lessorRate) {
    return lessorRate
  }
  if (!lc) {
    return 0
  }
  await getOrCacheLessorCommissions()
  const lessor = LESSOR_COMMISIONS[lc]
  if (!lessor) { throw new Error(`Verpächter mit code ${lc} nicht gefunden.`) }
  // TODO: Change to meet placeKey criteria
  const placeKey = `${ort}:${stateId}`
  if (placeKey in (lessor.cityRates || {})) {
    return lessor.cityRates[placeKey]
  }
  if (companyId in (lessor.companyRates || {})) {
    return lessor.companyRates[companyId]
  }
  return lessor.rate
}

module.exports = async function (job) {
  const { id } = job.data
  const quarterlyReport = await $getOrFail('QuarterlyReport', id)
  const quarter = quarterlyReport.get('quarter')

  if (quarterlyReport.get('status') === 'finalized') {
    throw new Error('This report has been finalized.')
  }

  consola.warn('STARTING JOB', id, quarter)

  await getOrCacheRegionalCommissions()
  await getOrCacheLessorCommissions()

  quarterlyReport.set('status', 'generating').set('jobId', job.id).save(null, { useMasterKey: true })
  job.progress('Getting quarterly data...')
  const { start, end } = getQuarterStartEnd(quarter)
  job.progress('Processing media invoices...')
  const mediaInvoices = await processMediaInvoices(start, end)
  job.progress('Processing custom invoices...')
  const customInvoices = await processCustomInvoices(start, end)
  const partnerBookings = await processPartnerQuarters(quarter)
  job.progress('Processing 0€ contracts...')
  const zeroContracts = await processCustomContracts(start, end)
  job.progress('Processing occupied cubes...')
  const occupiedCubes = await processOccupiedCubes(start, end)
  // job.progress('Processing media credit notes...')
  const creditNotes = await processCreditNotes(start, end)
  job.progress('Formatting data into rows...')
  const rows = await Promise.all([
    ...mediaInvoices,
    ...customInvoices,
    ...partnerBookings,
    ...zeroContracts,
    ...occupiedCubes,
    ...creditNotes
  ].map(async (row) => {
    // in quarterly reports we use only htCode
    row.htCode = row.htCode || row.hti || row.media
    delete row.htId
    delete row.hti
    delete row.media
    row.monthlyNet = row.monthly || 0
    row.total = row.total || round2((row.months || 0) * row.monthlyNet)
    row.totalNet = row.total

    if (row.agencyRate) {
      const agencyRatio = round5(row.agencyRate / 100) || 0
      const monthlyAgency = round2(row.monthlyNet * agencyRatio) || 0
      row.agencyTotal = round2(row.totalNet * agencyRatio) || 0
      row.monthlyNet = round2(row.monthlyNet - monthlyAgency) || 0
      row.totalNet = round2(row.totalNet - row.agencyTotal) || 0
    }
    const regionalCommission = await getRegionalCommissionRate(row)
    if (regionalCommission) {
      row.regionId = regionalCommission.regionId
      row.regionalRate = regionalCommission.rate
      const regionalRatio = round5(row.regionalRate / 100) || 0
      const monthlyRegional = round2(row.monthlyNet * regionalRatio) || 0
      row.regionalTotal = round2(row.totalNet * regionalRatio) || 0
      row.monthlyNet = round2(row.monthlyNet - monthlyRegional) || 0
      row.totalNet = round2(row.totalNet - row.regionalTotal) || 0
    }

    // subtract rheinkultur service rate (scouting etc 15%)
    row.serviceRate = 15
    const serviceRatio = round5(row.serviceRate / 100) || 0
    const monthlyService = round2(row.monthlyNet * serviceRatio) || 0
    row.serviceTotal = round2(row.totalNet * serviceRatio) || 0
    row.monthlyNet = round2(row.monthlyNet - monthlyService) || 0
    row.totalNet = round2(row.totalNet - row.serviceTotal) || 0

    const lessorRate = await getLessorCommissionRate(row)
    if (lessorRate) {
      row.lessorRate = lessorRate
      const lessorRatio = round5(row.lessorRate / 100)
      row.lessorTotal = round2(row.totalNet * lessorRatio) || 0
    }
    return row
  }))

  const rheinkultur = { total: 0, totalNet: 0, cubes: 0, orders: {} }
  const customers = {}
  const distributors = {}
  const agencies = {}
  const regionals = {}
  for (const region of await getOrCacheRegionalCommissions()) {
    regionals[region.regionId] = {
      regionId: region,
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

  job.progress('Almost done. Finalizing reports...')
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
  job.progress('Done!')
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
  consola.success('QUARTER COMPLETE', quarter)
  return Promise.resolve({})
}
