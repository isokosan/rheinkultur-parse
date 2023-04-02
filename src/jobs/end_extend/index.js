module.exports = async function (job) {
  const kinetic = await $query('Company').equalTo('name', 'Kinetic Germany GmbH').first({ useMasterKey: true })
  const extendContractsQuery = $query('Contract')
    .equalTo('status', 3)
    .equalTo('canceledAt', null)
    .lessThan('autoExtendsAt', await $today())
    .ascending('autoExtendsAt')
  !DEVELOPMENT && extendContractsQuery
    .notEqualTo('company', kinetic)
    .matchesQuery('company', $query('Company').notEqualTo('email', null))
  const endContractsQuery = Parse.Query.or(
    $query('Contract').notEqualTo('canceledAt', null),
    $query('Contract').equalTo('autoExtendsAt', null)
  )
    .equalTo('status', 3)
    .lessThan('endsAt', await $today())
    .ascending('endsAt')
  !DEVELOPMENT && endContractsQuery
    .notEqualTo('company', kinetic)
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
    const contract = await extendContractsQuery.include(['company']).first({ useMasterKey: true })
    if (!contract) { break }
    consola.info('auto extending contract', contract.id, contract.get('company').get('email'))
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