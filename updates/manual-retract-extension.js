// TODO: Check if invoices have already been generated, and make sure credit notes are written if invoiced.
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
  const audit = { fn: 'contract-extend-revert', data: { revertBy: autoExtendsBy, endsAt: [endsAt, newEndsAt] } }
  contract.set({ extendedDuration: newExtendedDuration, endsAt: newEndsAt })
  await contract.save(null, { useMasterKey: true, context: { audit } })
}

require('./run')(() => revertContractExtension(''))
