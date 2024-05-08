const { round2, round5 } = require('./utils')
const { getCubeSummaries } = require('./shared')

let REGIONAL_COMMISSIONS
async function getOrCacheRegionalCommissions (force) {
  force && (REGIONAL_COMMISSIONS = null)
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
    const kineticId = 'FNFCxMgEEr'
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
async function getOrCacheLessorCommissions (force) {
  force && (LESSOR_COMMISIONS = null)
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

async function processMediaInvoices (start, end, agency) {
  const response = []
  let i = 0
  const invoiceMediaRows = {}
  const invoicesQuery = $query('Invoice')
    .greaterThanOrEqualTo('status', 1)
    .lessThanOrEqualTo('status', 2)
    .notEqualTo('media', null)
    .greaterThan('periodEnd', start)
    .lessThanOrEqualTo('periodStart', end)
    .include(['company', 'contract', 'booking'])
  agency && invoicesQuery.equalTo('agency', agency)
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

async function mapReportRow (row) {
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
}

module.exports = {
  getOrCacheRegionalCommissions,
  getRegionalCommissionRate,
  getOrCacheLessorCommissions,
  getLessorCommissionRate,
  processMediaInvoices,
  mapReportRow
}
