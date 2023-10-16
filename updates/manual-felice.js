const contractNos = [
  'V23-0109',
  'V23-0119',
  'V23-0121',
  'V23-0122',
  'V23-0139',
  'V23-0145',
  'V23-0193',
  'V23-0205'
]

// const agencyId = 'MAI60j7nja'
const agencyId = '5m2JMX1lkh'
require('./run')(async () => {
  let i = 0
  let c = 0
  const agency = await $getOrFail('Company', agencyId)
  for (const contractNo of contractNos) {
    const contract = await $query('Contract').equalTo('no', contractNo).first({ useMasterKey: true })
    // update invoices
    await $query('Invoice')
      .equalTo('contract', contract)
      .notEqualTo('media', null)
      .notEqualTo('agency', agency)
      .each(async invoice => {
        invoice.set('agency', agency)
        invoice.set('commissionRate', 15)
        await invoice.save(null, { useMasterKey: true })
        console.log(invoice.attributes)
        i++
      }, { useMasterKey: true })

    if (!contract) {
      console.log(`Contract ${contractNo} not found`)
      continue
    }
    if (contract.get('agency')?.id === agencyId) {
      console.log(`Contract ${contractNo} already updated`)
      continue
    }
    contract.set('agency', agency)
    contract.set('commission', 15)
    const audit = { fn: 'contract-update', changes: { agencyId: [null, agencyId], commission: [null, 15] } }
    await contract.save(null, { useMasterKey: true, context: { audit } })
    console.log(`Contract ${contractNo} updated`)
    c++
  }
  await $query('Invoice').notEqualTo('commissionRate', null).each(inv => inv.save(null, { useMasterKey: true }), { useMasterKey: true })
  console.log({ c, i })
})

