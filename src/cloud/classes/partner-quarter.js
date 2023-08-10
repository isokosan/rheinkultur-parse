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
  !query._include.includes('bookings') && query.exclude('bookings')
})

Parse.Cloud.define('bookings-partner-quarter', async ({ params: { companyId, quarter }, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings') || user.get('company')?.id !== companyId) {
    throw new Error('Unbefugter Zugriff')
  }
  const company = await $getOrFail('Company', companyId)

  const getOrCalculatePartnerQuarter = async (company, quarter) => {
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
    const { pricingModel, commission, fixedPrice, fixedPriceMap } = company.get('distributor')
    // get pricing info
    const { start, end } = getQuarterStartEnd(quarter)
    const bookings = {}
    let endTotal = 0
    let total = 0
    await $query('Booking')
      .equalTo('company', company)
      .greaterThan('status', 2) // active, canceled or ended
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

          // totals
          total = round2(total + (row.monthly * row.months || 0))
          endTotal = round2(endTotal + (row.monthlyEnd * row.months || 0))

          bookings[booking.id] = row
        }
      }, { useMasterKey: true })

    partnerQuarter.set({
      bookings,
      bookingCount: Object.keys(bookings).length,
      total,
      endTotal
    })
    await partnerQuarter.save(null, { useMasterKey: true })
    return partnerQuarter.toJSON()
  }

  // fetch separately later and use this function as queue worker
  return {
    current: await getOrCalculatePartnerQuarter(company, quarter),
    last: await getOrCalculatePartnerQuarter(company, moment(quarter, 'Q-YYYY').subtract(1, 'quarter').format('Q-YYYY'))
  }
}, { requireUser: true })

Parse.Cloud.define('bookings-partner-quarter-close', async ({ params: { companyId, quarter }, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings') || user.get('company')?.id !== companyId) {
    throw new Error('Unbefugter Zugriff')
  }
  const company = await $getOrFail('Company', companyId)
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