const { setCubeOrderStatuses } = require('@/shared')
module.exports = async function (job) {
  const cubeCountAggregate = [
    { $group: { _id: 'id', cubeCount: { $sum: '$cubeCount' } } }
  ]
  // get all contracts and set their cube statuses
  const total = await Promise.all([
    $query('Contract').aggregate(cubeCountAggregate),
    $query('Booking').aggregate(cubeCountAggregate)
  ]).then(([[contractCount], [bookingCount]]) => contractCount.cubeCount + bookingCount.cubeCount)
  let c = 0
  await $query('Contract').each(async (contract) => {
    await setCubeOrderStatuses(contract)
    c += contract.get('cubeCount')
    job.progress(parseInt(100 * c / total))
  }, { useMasterKey: true })
  let b = 0
  await $query('Booking').each(async (booking) => {
    await setCubeOrderStatuses(booking)
    b += booking.get('cubeCount')
    job.progress(parseInt(100 * (c + b) / total))
  }, { useMasterKey: true })
  return Promise.resolve({ contracts: c, bookings: b })
}