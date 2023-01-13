module.exports = async function (job) {
  const addressHasEmailQuery = $query('Address').notEqualTo('email', null)
  const extendContractsQuery = Parse.Query.or(
    $query('Contract').notEqualTo('invoiceAddress', null).matchesQuery('invoiceAddress', addressHasEmailQuery),
    $query('Contract').equalTo('invoiceAddress', null).matchesQuery('address', addressHasEmailQuery)
  )
    .equalTo('status', 3)
    .equalTo('canceledAt', null)
    .lessThan('autoExtendsAt', await $today())
    .ascending('autoExtendsAt')
  const endContractsQuery = Parse.Query.or(
    $query('Contract').notEqualTo('canceledAt', null),
    $query('Contract').equalTo('autoExtendsAt', null)
  )
    .equalTo('status', 3)
    .lessThan('endsAt', await $today())
    .ascending('endsAt')
  const extendBookingsQuery = $query('Booking')
    .equalTo('status', 3)
    .equalTo('canceledAt', null)
    .lessThan('autoExtendsAt', await $today())
    .ascending('autoExtendsAt')
  const endBookingsQuery = Parse.Query.or(
    $query('Booking').notEqualTo('canceledAt', null),
    $query('Booking').equalTo('autoExtendsAt', null)
  )
    .equalTo('status', 3)
    .lessThan('endsAt', await $today())
    .ascending('endsAt')

  const total = await Promise.all([extendContractsQuery, endContractsQuery, extendBookingsQuery, endBookingsQuery].map(query => query.count({ useMasterKey: true })))
    .then(counts => counts.reduce((total, count) => total + count, 0))

  let extendedContracts = 0
  let endedContracts = 0
  let extendedBookings = 0
  let endedBookings = 0

  while (true) {
    const contract = await extendContractsQuery.include(['address', 'invoiceAddress']).first({ useMasterKey: true })
    if (!contract) { break }
    consola.info('auto extending contract', contract.id, contract.get('invoiceAddress')?.get('email') || contract.get('address')?.get('email'))
    await Parse.Cloud.run('contract-extend', { id: contract.id, email: !DEVELOPMENT }, { useMasterKey: true })
    extendedContracts++
    job.progress(parseInt(100 * (extendedContracts + endedContracts + extendedBookings + endedBookings) / total))
  }
  while (true) {
    const contract = await endContractsQuery.first({ useMasterKey: true })
    if (!contract) { break }
    consola.info('auto ending contract', contract.id)
    await Parse.Cloud.run('contract-end', { id: contract.id }, { useMasterKey: true })
    endedContracts++
    job.progress(parseInt(100 * (extendedContracts + endedContracts + extendedBookings + endedBookings) / total))
  }
  while (true) {
    const booking = await extendBookingsQuery.first({ useMasterKey: true })
    if (!booking) { break }
    consola.info('auto extending booking', booking.id)
    await Parse.Cloud.run('booking-extend', { id: booking.id }, { useMasterKey: true })
    extendedBookings++
    job.progress(parseInt(100 * (extendedContracts + endedContracts + extendedBookings + endedBookings) / total))
  }
  while (true) {
    const booking = await endBookingsQuery.first({ useMasterKey: true })
    if (!booking) { break }
    consola.info('auto ending booking', booking.id)
    await Parse.Cloud.run('booking-end', { id: booking.id }, { useMasterKey: true })
    endedBookings++
    job.progress(parseInt(100 * (extendedContracts + endedContracts + extendedBookings + endedBookings) / total))
  }
  return Promise.resolve({ extendedContracts, endedContracts, extendedBookings, endedBookings })
}
