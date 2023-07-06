async function check () {
  const keys = {}
  const dups = []
  const invoices = await $query('Invoice')
    .notEqualTo('contract', null)
    .notEqualTo('status', 3)
    .select(['contract', 'date', 'total', 'lexNo'])
    .limit(100000)
    .find({ useMasterKey: true })
  for (const invoice of invoices) {
    const { lexNo, date, contract, total } = invoice.attributes
    if (contract.id === 'FklcCEAe4Q') {
      continue
    }
    const key = [date, contract.id, total].join('-')
    console.log(key, lexNo)
    if (keys[key]) {
      dups.push(invoice.id)
      dups.push(keys[key])
      continue
    }
    keys[key] = invoice.id
  }
  console.warn(invoices.length)
  console.error(dups)
  return dups
}

require('./run')(check)
