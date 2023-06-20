// When canceling cubes, or canceling an order - we should have an easy way of generating the lists right away
// TODO: This should also remember cases where user wants to remove a disassembly, or mark one as done - this info should persist.

const { processOrder } = require('@/cloud/classes/fieldwork/disassemblies')

module.exports = async function (job) {
  // get all disassembly RMV orders
  // TODO: Remove disassemblies no longer set as fromRMV
  const contractsQuery = $query('Contract').equalTo('disassembly.fromRMV', true)
  const bookingsQuery = $query('Booking').equalTo('disassembly.fromRMV', true)

  const total = (await contractsQuery.count({ useMasterKey: true })) + (await bookingsQuery.count({ useMasterKey: true }))
  let orders = 0
  let tasks = 0
  await contractsQuery.each(async (contract) => {
    tasks += await processOrder('Contract', contract.id)
    orders++
    job.progress(parseInt(orders / total * 100))
  }, { useMasterKey: true })
  await bookingsQuery.each(async (booking) => {
    tasks += await processOrder('Booking', booking.id)
    orders++
    job.progress(parseInt(orders / total * 100))
  }, { useMasterKey: true })

  return Promise.resolve({ orders, tasks })
}
