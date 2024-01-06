const redis = require('@/services/redis')
const { round2 } = require('@/utils')
const { errorFlagKeys } = require('@/cloud/cube-flags')

async function calculateStats (startOfMonth, endOfMonth) {
  const kinetic = await $getOrFail('Company', 'FNFCxMgEEr')
  const distributorIds = await $query('Company').notEqualTo('distributor', null).distinct('objectId', { useMasterKey: true })
  const stats = {
    revenue: {
      media: 0,
      production: 0,
      distributors: 0,
      kinetic: 0,
      total: 0
    }, // revenue type (media / production / distributors / kinetic / total)
    customers: {}, // active customers
    distributors: {}, // companyId keys
    contracts: { count: 0, cubes: 0, starting: 0, ending: 0 },
    kinetic: { count: 0, cubes: 0, starting: 0, ending: 0 },
    bookings: { count: 0, starting: 0, ending: 0 }
  }
  await $query('Invoice')
    .equalTo('status', 2)
    .greaterThanOrEqualTo('date', startOfMonth)
    .lessThanOrEqualTo('date', endOfMonth)
    .select(['netTotal', 'company', 'media', 'production'])
    .eachBatch(batch => batch.forEach((invoice) => {
      const total = invoice.get('netTotal')
      stats.revenue.total = round2(stats.revenue.total + total)
      const companyId = invoice.get('company').id
      if (companyId === 'FNFCxMgEEr') {
        stats.revenue.kinetic = round2(stats.revenue.kinetic + total)
      } else if (distributorIds.includes(companyId)) {
        stats.distributors[companyId] = round2((stats.distributors[companyId] || 0) + total)
        stats.revenue.distributors = round2(stats.revenue.distributors + total)
      } else {
        const mediaTotal = invoice.get('media')?.total || 0
        const productionTotal = invoice.get('production')?.total || 0
        stats.revenue.media = round2(stats.revenue.media + mediaTotal)
        stats.revenue.production = round2(stats.revenue.production + productionTotal)
      }
    }), { useMasterKey: true })
  await $query('CreditNote')
    .equalTo('status', 2)
    .greaterThanOrEqualTo('date', startOfMonth)
    .lessThanOrEqualTo('date', endOfMonth)
    .select(['netTotal', 'company', 'mediaItems'])
    .eachBatch(batch => batch.forEach((creditNote) => {
      const total = creditNote.get('netTotal')
      stats.revenue.total = round2(stats.revenue.total - total)
      const companyId = creditNote.get('company').id
      if (companyId === 'FNFCxMgEEr') {
        stats.revenue.kinetic = round2(stats.revenue.kinetic - total)
      } else if (distributorIds.includes(companyId)) {
        stats.distributors[companyId] = round2((stats.distributors[companyId] || 0) - total)
        stats.revenue.distributors = round2(stats.revenue.distributors - total)
      } else {
        const mediaTotal = Object.values(creditNote.get('mediaItems') || {}).reduce((acc, item) => acc + item.total, 0)
        stats.revenue.media = round2(stats.revenue.media - mediaTotal)
      }
    }), { useMasterKey: true })
  await $query('Contract')
    .greaterThan('status', 2)
    .lessThanOrEqualTo('startsAt', endOfMonth)
    .greaterThanOrEqualTo('endsAt', startOfMonth)
    .notEqualTo('company', kinetic)
    .select(['cubeCount', 'startsAt', 'endsAt'])
    .eachBatch(batch => batch.forEach((contract) => {
      stats.contracts.count++
      stats.contracts.cubes += contract.get('cubeCount')
      stats.contracts.starting += contract.get('startsAt') > startOfMonth ? 1 : 0
      stats.contracts.ending += contract.get('endsAt') < endOfMonth ? 1 : 0
    }), { useMasterKey: true })
  await $query('Contract')
    .greaterThan('status', 2)
    .lessThanOrEqualTo('startsAt', endOfMonth)
    .greaterThanOrEqualTo('endsAt', startOfMonth)
    .equalTo('company', kinetic)
    .select(['cubeCount', 'startsAt', 'endsAt'])
    .eachBatch(batch => batch.forEach((contract) => {
      stats.kinetic.count++
      stats.kinetic.cubes += contract.get('cubeCount')
      stats.kinetic.starting += contract.get('startsAt') > startOfMonth ? 1 : 0
      stats.kinetic.ending += contract.get('endsAt') < endOfMonth ? 1 : 0
    }), { useMasterKey: true })
  await $query('Booking')
    .greaterThan('status', 2)
    .lessThanOrEqualTo('startsAt', endOfMonth)
    .greaterThanOrEqualTo('endsAt', startOfMonth)
    .select(['startsAt', 'endsAt'])
    .eachBatch(batch => batch.forEach((booking) => {
      stats.bookings.count++
      stats.bookings.starting += booking.get('startsAt') > startOfMonth ? 1 : 0
      stats.bookings.ending += booking.get('endsAt') < endOfMonth ? 1 : 0
    }), { useMasterKey: true })

  const verifiedQuery = $query('Cube')
    .notEqualTo('vAt', null)
    .notEqualTo('p1', null)
    .notEqualTo('p2', null)
    .lessThanOrEqualTo('vAt', moment(endOfMonth).endOf('day').toDate())

  stats.verified = {
    total: await verifiedQuery.count({ useMasterKey: true }),
    new: await verifiedQuery
      .greaterThanOrEqualTo('vAt', moment(startOfMonth).startOf('day').toDate())
      .count({ useMasterKey: true })
  }
  return stats
}

module.exports = async function (job) {
  let m = 0
  const carry = moment('2023-01-01')
  const today = await $today()
  const months = moment(today).diff(carry, 'months')
  while (carry.isSameOrBefore(today, 'month')) {
    const month = carry.format('YYYY-MM')
    const start = moment(month).startOf('month').format('YYYY-MM-DD')
    const end = moment(month).endOf('month').format('YYYY-MM-DD')
    const stats = await calculateStats(start, end)
    await redis.hset('stats:monthlies', month, JSON.stringify(stats))
    m++
    carry.add(1, 'month')
    job.progress(parseInt(90 * m / months))
  }

  // latest totals
  const getBaseQuery = () => $query('Cube').equalTo('dAt', null).equalTo('pair', null)
  const total = await getBaseQuery().count({ useMasterKey: true })
  const marketable = await getBaseQuery()
    .notContainedIn('flags', errorFlagKeys)
    .count({ useMasterKey: true })
  const scout = await getBaseQuery()
    .notContainedIn('flags', errorFlagKeys)
    .notEqualTo('vAt', null)
    .notEqualTo('p1', null)
    .notEqualTo('p2', null)
    .count({ useMasterKey: true })
  const marketed = await Parse.Query.and(
    getBaseQuery(),
    Parse.Query.or(
      $query('Cube').notEqualTo('order', null),
      $query('Cube').notEqualTo('futureOrder', null)
    )
  ).count({ useMasterKey: true })
  await redis.hset('stats:cube-totals', 'total', total)
  await redis.hset('stats:cube-totals', 'marketable', marketable)
  await redis.hset('stats:cube-totals', 'scout', scout)
  await redis.hset('stats:cube-totals', 'marketed', marketed)
  job.progress(100)
  return Promise.resolve({ m })
}
