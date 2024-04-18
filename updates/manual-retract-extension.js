// TODO: Check if invoices have already been generated, and make sure credit notes are written if invoiced.
// TOTEST: Make sure fixed price changes are reverted if any
async function revertContractExtension (contractId) {
  const contract = await $getOrFail('Contract', contractId)
  const extendedDuration = contract.get('extendedDuration') || 0
  const autoExtendsBy = contract.get('autoExtendsBy') || 12
  if (!extendedDuration || extendedDuration < autoExtendsBy) {
    throw new Error('Contract not extended')
  }

  const newExtendedDuration = extendedDuration - autoExtendsBy
  const endsAt = contract.get('endsAt')
  const newEndsAt = moment(endsAt).subtract(autoExtendsBy, 'months').format('YYYY-MM-DD')

  // monthly media changes: find the last extension audit
  const extendAudit = await $query('Audit')
    .equalTo('itemClass', 'Contract')
    .equalTo('itemId', contractId)
    .equalTo('fn', 'contract-extend')
    .descending('createdAt')
    .first({ useMasterKey: true })

  if (!extendAudit) {
    throw new Error('No extension audit found')
  }
  const data = extendAudit.get('data')
  if (data.endsAt[0] !== newEndsAt) {
    throw new Error('EndsAt mismatch')
  }
  // before monthly media
  const monthlyMedia = data.changes?.monthlyMedia[0]
  let changes
  if (monthlyMedia) {
    changes = await $changes(contract, { monthlyMedia })
    contract.set({ monthlyMedia })
  }

  const audit = { fn: 'contract-extend-revert', data: { revertBy: autoExtendsBy, endsAt: [endsAt, newEndsAt], changes } }
  contract.set({ extendedDuration: newExtendedDuration, endsAt: newEndsAt })
  await contract.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}

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

require('./run')(() => revertContractExtension('vHxumJ4GKH'))
