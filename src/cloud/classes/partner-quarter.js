const { ensureUniqueField, round2, round5 } = require('@/utils')
const { getQuarterStartEnd, getCubeSummary } = require('@/shared')
const PartnerQuarter = Parse.Object.extend('PartnerQuarter')

function validateQuarterYearString (str) {
  const regex = /^[1-4]-\d{4}$/
  if (!regex.test(str)) {
    throw new Error('Invalid quarter year string')
  }
}

Parse.Cloud.beforeSave(PartnerQuarter, async ({ object: partnerQuarter }) => {
  validateQuarterYearString(partnerQuarter.get('quarter'))
  await ensureUniqueField(partnerQuarter, 'quarter', 'company')
})

Parse.Cloud.beforeFind(PartnerQuarter, ({ query }) => {
  !query._include.includes('rows') && query.exclude('rows')
})

Parse.Cloud.afterFind(PartnerQuarter, async ({ objects }) => {
  for (const partnerQuarter of objects) {
    partnerQuarter.get('status') !== 'finalized' && partnerQuarter.set('pendingCount', await $query('Booking')
      .equalTo('company', partnerQuarter.get('company'))
      .equalTo('status', 3) // aktiv
      .lessThanOrEqualTo('endsAt', getQuarterStartEnd(partnerQuarter.get('quarter')).end)
      .count({ useMasterKey: true }))
  }
})

const getOrCalculatePartnerQuarter = async (companyId, quarter) => {
  const company = await $getOrFail('Company', companyId)
  const partnerQuarter = await $query(PartnerQuarter)
    .equalTo('company', company)
    .equalTo('quarter', quarter)
    .first({ useMasterKey: true }) || new PartnerQuarter({
    company,
    quarter
  })
  if (partnerQuarter && partnerQuarter.get('status') === 'finalized') {
    return partnerQuarter.toJSON()
  }
  const { pricingModel, commission, fixedPrice, fixedPriceMap, periodicInvoicing } = company.get('distributor')
  const { start, end } = getQuarterStartEnd(quarter)
  const bookings = {}
  let total = 0
  await $query('Booking')
    .equalTo('company', company)
    .greaterThanOrEqualTo('status', 3) // active, canceled or ended
    .greaterThan('endsAt', start)
    .lessThanOrEqualTo('startsAt', end)
    .include(['cube', 'cube.state', 'cube.ht'])
    .eachBatch((batch) => {
      for (const booking of batch) {
        const cubeSummary = getCubeSummary(booking.get('cube'))
        const periodStart = booking.get('startsAt') > start
          ? booking.get('startsAt')
          : start
        const periodEnd = booking.get('endsAt') < end
          ? booking.get('endsAt')
          : end
        const row = {
          orderNo: booking.get('no'),
          companyId: booking.get('company')?.id,
          companyName: booking.get('company')?.get('name'),
          ...cubeSummary,
          periodStart,
          periodEnd,
          autoExtendsBy: booking.get('autoExtendsBy'),
          canceledAt: booking.get('canceledAt'),
          months: moment(periodEnd).add(1, 'days').diff(periodStart, 'months', true),
          monthly: 0
        }

        // company and pricing
        row.distributorId = company.id
        if (pricingModel === 'commission' && commission) {
          row.monthlyEnd = booking.get('endPrices')?.[cubeSummary.objectId] || 0
          row.distributorRate = commission
          const distributorRatio = round5(row.distributorRate / 100)
          row.monthlyDistributor = round2(row.monthlyEnd * distributorRatio)
          row.monthly = round2(row.monthlyEnd - row.monthlyDistributor)
        }
        if (pricingModel === 'fixed') {
          row.monthly = fixedPrice || fixedPriceMap[cubeSummary.media]
        }
        if (!pricingModel && booking.get('monthlyMedia')?.[cubeSummary.objectId]) {
          row.monthly = booking.get('monthlyMedia')?.[cubeSummary.objectId]
        }

        const { startsAt, endsAt, initialDuration, extendedDuration } = booking.attributes
        row.start = startsAt
        row.end = endsAt
        row.duration = initialDuration
        if (extendedDuration) {
          row.duration += `+${extendedDuration}`
        }
        row.motive = booking.get('motive')
        row.externalOrderNo = booking.get('externalOrderNo')
        row.campaignNo = booking.get('campaignNo')
        row.total = round2(row.monthly * (row.months || 0))

        bookings[booking.id] = row
        total = round2(total + row.total)
      }
    }, { useMasterKey: true })

  const rows = Object.values(bookings).sort((a, b) => a.orderNo > b.orderNo ? 1 : -1)
  if (periodicInvoicing?.total) {
    // add row with invoice total
    const invoice = await $query('Invoice')
      .equalTo('company', company)
      .include('lessor')
      .equalTo('periodicDistributorQuarter', quarter)
      .first({ useMasterKey: true })
    if (invoice) {
      const row = {
        voucherNos: invoice.get('lexNo'),
        lc: invoice.get('lessor').get('lessor').code,
        distributorId: company.id,
        companyId: company.id,
        companyName: company.get('name'),
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
      rows.push(row)
      total = round2(total + row.total)
    }
  }

  partnerQuarter.set({
    rows,
    total,
    count: rows.length
  })

  await partnerQuarter.save(null, { useMasterKey: true })
  return partnerQuarter.toJSON()
}

Parse.Cloud.define('partner-quarters', async ({ user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings')) {
    throw new Error('Unbefugter Zugriff')
  }
  const companyId = user.get('company').id
  const quarter = moment(await $today()).format('Q-YYYY')
  const current = await getOrCalculatePartnerQuarter(companyId, quarter)
  const lastQuarter = moment(quarter, 'Q-YYYY').subtract(1, 'quarter')
  const last = lastQuarter.isBefore('2023-07-01', 'quarter')
    ? null
    : await getOrCalculatePartnerQuarter(companyId, lastQuarter.format('Q-YYYY'))
  return { current, last }
}, { requireUser: true })

Parse.Cloud.define('partner-quarter-close', async ({ params: { companyId, quarter }, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings') || user.get('company')?.id !== companyId) {
    throw new Error('Unbefugter Zugriff')
  }

  // if there are any bookings that are ending / extending inside the quarter, throw an error here
  const company = await $getOrFail('Company', companyId)
  const { end } = getQuarterStartEnd(quarter)
  // check bookings ended / extended
  const pendingNos = await $query('Booking')
    .equalTo('company', company)
    .equalTo('status', 3) // aktiv
    .lessThanOrEqualTo('endsAt', end)
    .distinct('no', { useMasterKey: true })
  if (pendingNos.length) {
    throw new Error('Es gibt noch Buchungen die im Quartal enden oder verlängert werden müssen: ' + pendingNos.join(', '))
  }

  const partnerQuarter = await $query(PartnerQuarter)
    .equalTo('company', company)
    .equalTo('quarter', quarter)
    .first({ useMasterKey: true })
  partnerQuarter.set({
    status: 'finalized'
  })
  await partnerQuarter.save(null, { useMasterKey: true })
  return {
    message: 'Quartal abgeschlossen',
    data: partnerQuarter.toJSON()
  }
}, { requireUser: true })

Parse.Cloud.define('partner-quarter', async ({ params: { companyId, quarter } }) => {
  return getOrCalculatePartnerQuarter(companyId, quarter)
}, { requireMaster: true })
