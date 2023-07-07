const { setContractCubeStatuses, setBookingCubeStatus } = require('@/shared')
module.exports = async function (job) {
  const response = { contracts: {}, bookings: {}, updatedOrders: 0, updatedCubes: 0 }
  let i = 0
  const cubeCountAggregate = [
    { $group: { _id: 'id', cubeCount: { $sum: '$cubeCount' } } }
  ]
  // get all contracts and set their cube statuses
  const total = await Promise.all([
    $query('Contract').aggregate(cubeCountAggregate),
    $query('Booking').aggregate(cubeCountAggregate)
  ]).then(([[contractCount], [bookingCount]]) => contractCount.cubeCount + bookingCount.cubeCount)
  await $query('Contract').eachBatch(async (contracts) => {
    for (const contract of contracts) {
      const { set, unset } = await setContractCubeStatuses(contract)
      i += contract.get('cubeCount')
      if (set.length || unset.length) {
        consola.info({ no: contract.get('no'), set, unset })
        response.contracts[contract.get('no')] = { set, unset }
        response.updatedCubes += (set.length + unset.length)
        response.updatedOrders += 1
      }
      job.progress(parseInt(100 * i / total))
    }
  }, { useMasterKey: true })
  await $query('Booking').include('cube').eachBatch(async (bookings) => {
    for (const booking of bookings) {
      const { set, unset } = await setBookingCubeStatus(booking)
      i++
      if (set.length || unset.length) {
        consola.info({ no: booking.get('no'), set, unset })
        response.bookings[booking.get('no')] = { set, unset }
        response.updatedCubes += (set.length + unset.length)
        response.updatedOrders += 1
      }
      job.progress(parseInt(100 * i / total))
    }
  }, { useMasterKey: true })
  response.checkedCubes = i
  return Promise.resolve(response)
}
