Parse.Cloud.define('manual-updates-disassemblies', async () => {
  const { bookings, contracts } = require('@/seed/data/processed-disassemblies.json')
  let b = 0
  let c = 0
  while (true) {
    const booking = await $query('Booking')
      .notEqualTo('disassembly', true)
      .containedIn('no', bookings)
      .first({ useMasterKey: true })
    if (!booking) { break }
    booking.set({ disassembly: true })
    await booking.save(null, { useMasterKey: true })
    b++
  }
  while (true) {
    const contract = await $query('Contract')
      .notEqualTo('disassembly', true)
      .containedIn('no', contracts)
      .first({ useMasterKey: true })
    if (!contract) { break }
    contract.set({ disassembly: true })
    await contract.save(null, { useMasterKey: true })
    c++
  }
  return { b, c }
}, { requireMaster: true })
