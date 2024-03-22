require('./run')(async () => {
  // now transition flag TTMR'S
  // const cubes = await $query('Cube').equalTo('flags', 'TTMR')
  //   .limit(1000)
  //   .select('pk')
  //   .find({ useMasterKey: true })
  // const locations = {}
  // for (const cube of cubes) {
  //   locations[cube.get('pk')] = locations[cube.get('pk')] || []
  //   locations[cube.get('pk')].push(cube.id)
  // }
  // for (const pk of Object.keys(locations)) {
  //   const fm = await $query('FrameMount').equalTo('pk', pk).first({ useMasterKey: true })
  //   await fm.set('cubeIds', locations[pk]).save(null, { useMasterKey: true })
  // }

  // update all bookings from konzepthaus with endDates after today to demontage von Rheinkultur
  const company = await $getOrFail('Company', 'XPLYKFS9Pc')
  let i = 0
  await $query('Booking')
    .equalTo('company', company)
    .greaterThanOrEqualTo('endsAt', '2024-03-22')
    .notEqualTo('disassembly.fromRMV', true)
    .each(async (booking) => {
      const changes = {}
      if (!booking.get('disassembly')?.fromRMV) {
        changes.disassemblyFromRMV = [false, true]
        booking.set({ disassembly: { fromRMV: true } })
        const audit = { fn: 'booking-update', data: { changes } }
        await booking.save(null, { useMasterKey: true, context: { audit } })
        i++
      }
    }, { useMasterKey: true })
  console.log(`Updated ${i} bookings`)
})
