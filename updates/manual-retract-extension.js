// // TODO: Check if invoices have already been generated, and make sure credit notes are written if invoiced.
// async function revertContractExtension (contractId) {
//   const contract = await $getOrFail('Contract', contractId)
//   const extendedDuration = contract.get('extendedDuration') || 0
//   const autoExtendsBy = contract.get('autoExtendsBy') || 12
//   if (!extendedDuration || extendedDuration < autoExtendsBy) {
//     throw new Error('Contract not extended')
//   }
//   const newExtendedDuration = extendedDuration - autoExtendsBy
//   const endsAt = contract.get('endsAt')
//   const newEndsAt = moment(endsAt).subtract(autoExtendsBy, 'months').format('YYYY-MM-DD')
//   const audit = { fn: 'contract-extend-revert', data: { revertBy: autoExtendsBy, endsAt: [endsAt, newEndsAt] } }
//   contract.set({ extendedDuration: newExtendedDuration, endsAt: newEndsAt })
//   await contract.save(null, { useMasterKey: true, context: { audit } })
// }

// async function revertBookingExtension (bookingId) {
//   const booking = await $getOrFail('Booking', bookingId)
//   const extendedDuration = booking.get('extendedDuration') || 0
//   const autoExtendsBy = booking.get('autoExtendsBy') || 12
//   if (!extendedDuration || extendedDuration < autoExtendsBy) {
//     throw new Error('Booking not extended')
//   }
//   const newExtendedDuration = extendedDuration - autoExtendsBy
//   const endsAt = booking.get('endsAt')
//   const newEndsAt = moment(endsAt).subtract(autoExtendsBy, 'months').format('YYYY-MM-DD')
//   const audit = { fn: 'booking-extend-revert', data: { revertBy: autoExtendsBy, endsAt: [endsAt, newEndsAt] } }
//   booking.set({ extendedDuration: newExtendedDuration, endsAt: newEndsAt })
//   await booking.save(null, { useMasterKey: true, context: { audit } })
// }

// require('./run')(() => revertBookingExtension('J9UMATyQ1v'))
