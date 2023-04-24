const { setCubeOrderStatuses } = require('@/shared')
module.exports = async function (job) {
  // get all contracts and set their cube statuses
  const total = await Promise.all([
    $query('Contract').count({ useMasterKey: true }),
    $query('Booking').count({ useMasterKey: true })
  ]).then(([contractCount, bookingCount]) => contractCount + bookingCount)
  let c = 0
  await $query('Contract').each(async (contract) => {
    await setCubeOrderStatuses(contract)
    c++
    job.progress(parseInt(100 * c / total))
  }, { useMasterKey: true })
  let b = 0
  await $query('Booking').each(async (booking) => {
    await setCubeOrderStatuses(booking)
    b++
    job.progress(parseInt(100 * (c + b) / total))
  }, { useMasterKey: true })
  return Promise.resolve({ contracts: c, bookings: b })
}
