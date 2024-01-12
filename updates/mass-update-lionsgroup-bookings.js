require('./run')(async () => {
  let i = 0
  const company = await $getOrFail('Company', '4EBkZmBra0')
  await company.set('distributor', {}).save(null, { useMasterKey: true })
  await $query('Booking')
    .equalTo('company', company)
    .equalTo('monthlyMedia', null)
    .eachBatch(async (bookings) => {
      for (const booking of bookings) {
        const monthlyMedia = {
          [booking.get('cube').id]: 40
        }
        const changes = $changes(booking, { monthlyMedia })
        const audit = { fn: 'booking-update', data: { changes } }
        booking.set('monthlyMedia', monthlyMedia)
        await booking.save(null, { useMasterKey: true, context: { audit } })
        i++
      }
    }, { useMasterKey: true })
  console.log('done', i)
})
