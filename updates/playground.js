require('./run')(async () => {
  let i = 0
  await $query('Invoice')
    .equalTo('date', '2024-05-18')
    .equalTo('status', 2)
    .equalTo('lexId', null)
    .equalTo('lexUri', null)
    .equalTo('lexNo', null)
    .each(async (invoice) => {
      if (invoice.get('lexId')) {
        console.log('Invoice already has lexId', invoice.id)
        return
      }
      invoice
        .set('status', 1)
        .set('date', '2024-05-21')
        .unset('voucherDate')
      await invoice.save(null, { useMasterKey: true })
      i++
    }, { useMasterKey: true })
  console.log('OK')
  console.log(i)
})
