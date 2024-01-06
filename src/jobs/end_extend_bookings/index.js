module.exports = async function (job) {
  const extendBookingsQuery = $query('Booking')
    .equalTo('status', 3)
    .notEqualTo('autoExtendsBy', null)
    .equalTo('request', null) // make sure no bookings with requests are extended
    .equalTo('canceledAt', null)
    .lessThan('autoExtendsAt', await $today())
    .ascending('autoExtendsAt')
  const endBookingsQuery = Parse.Query.or(
    $query('Booking').notEqualTo('canceledAt', null),
    $query('Booking').equalTo('autoExtendsAt', null)
  )
    .equalTo('status', 3)
    .equalTo('request', null) // make sure no bookings with requests are extended
    .lessThan('endsAt', await $today())
    .ascending('endsAt')

  const total = await Promise.all([extendBookingsQuery, endBookingsQuery].map(query => query.count({ useMasterKey: true })))
    .then(counts => counts.reduce((total, count) => total + count, 0))
  let extendedBookings = 0
  let endedBookings = 0
  while (true) {
    const booking = await extendBookingsQuery.first({ useMasterKey: true })
    if (!booking) { break }
    consola.info('auto extending booking', booking.id)
    await Parse.Cloud.run('order-extend', { className: 'Booking', id: booking.id }, { useMasterKey: true })
    extendedBookings++
    job.progress(parseInt(100 * (extendedBookings + endedBookings) / total))
  }
  while (true) {
    const booking = await endBookingsQuery.first({ useMasterKey: true })
    if (!booking) { break }
    consola.info('auto ending booking', booking.id)
    await Parse.Cloud.run('booking-end', { id: booking.id }, { useMasterKey: true })
    endedBookings++
    job.progress(parseInt(100 * (extendedBookings + endedBookings) / total))
  }
  return Promise.resolve({ extendedBookings, endedBookings })
}
