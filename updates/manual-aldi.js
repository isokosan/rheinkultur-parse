require('./run')(async () => {
  const ALDI = await $getOrFail('Tag', 'ALDI')
  await $query('Company').equalTo('tags', ALDI).each(async (company) => {
    console.log(company.get('name'))
    const addresses = await $query('Address')
      .equalTo('company', company)
      .find({ useMasterKey: true })
    if (addresses.length !== 2) {
      console.log('SKIP NON 2 ADDRESS')
      return
    }
    const lexAddress = addresses.find(address => address.get('lex'))
    const nonLexAddress = addresses.find(address => !address.get('lex'))
    await $query('Contract').equalTo('company', company).equalTo('address', nonLexAddress).each((contract) => {
      return contract.set('address', lexAddress).unset('invoiceAddress').save(null, { useMasterKey: true, context: { recalculatePlannedInvoices: true } })
    }, { useMasterKey: true })
    await $query('Invoice').equalTo('address', nonLexAddress).first({ useMasterKey: true }).then(console.log)
    await $query('CreditNote').equalTo('address', nonLexAddress).first({ useMasterKey: true }).then(console.log)
    await nonLexAddress.destroy({ useMasterKey: true })
  }, { useMasterKey: true })
})
