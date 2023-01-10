async function removeDueDates () {
  consola.info('removing calculated dueDate field')
  let i = 0
  while (true) {
    const invoices = await $query('Invoice')
      .notEqualTo('dueDate', null)
      .find({ useMasterKey: true })
    if (!invoices.length) { break }
    for (const invoice of invoices) {
      invoice.unset('dueDate')
      await invoice.save(null, { useMasterKey: true })
    }
    i += invoices.length
  }
  consola.info(`unset ${i} invoice dueDates`)
}
Parse.Cloud.define('manual-updates-remove-due-dates', () => {
  removeDueDates()
  return 'ok'
}, { requireMaster: true })

async function updatePastPlannedInvoiceDates (date) {
  consola.info(`updating past planned invoice dates to ${date}`)
  let i = 0
  while (true) {
    const invoices = await $query('Invoice')
      .equalTo('status', 1)
      .lessThan('date', date)
      .find({ useMasterKey: true })
    if (!invoices.length) { break }
    for (const invoice of invoices) {
      invoice.set('date', date)
      await invoice.save(null, { useMasterKey: true })
    }
    i += invoices.length
  }
  consola.info(`updated ${i} invoice dates`)
}
Parse.Cloud.define('manual-updates-update-past-planned-invoice-dates', ({ params: { date } }) => {
  if (!date) {
    throw new Error('Date')
  }
  updatePastPlannedInvoiceDates(date)
  return 'ok'
}, { requireMaster: true })

async function rewritePlannedIntroductions () {
  consola.info('updating planned invoice introductions')
  let i = 0
  while (true) {
    const invoices = await $query('Invoice')
      .equalTo('status', 1)
      .skip(i)
      .find({ useMasterKey: true })
    if (!invoices.length) { break }
    for (const invoice of invoices) {
      await invoice.save(null, { useMasterKey: true, context: { rewriteIntroduction: true } })
    }
    i += invoices.length
  }
  consola.info(`updated ${i} invoice introductions`)
}
Parse.Cloud.define('manual-updates-rewrite-planned-introductions', () => {
  rewritePlannedIntroductions()
  return 'ok'
}, { requireMaster: true })

// KLIMM & ALDI Companies update, and update Contracts & planned invoices too (with a function within the updates)
async function updateCompanyDueDates () {
  const klimm = await $query('Company').equalTo('name', 'KLIMM Media GmbH & Co. KG').first({ useMasterKey: true })
  const aldiTag = await $getOrFail('Tag', 'ALDI')
  const companies = [klimm, ...await $query('Company').equalTo('tags', aldiTag).find({ useMasterKey: true })]
  for (const company of companies) {
    if (company.get('dueDays') !== 30) {
      await company.set('dueDays', 30).save(null, { useMasterKey: true })
    }
  }

  // update all contracts
  while (true) {
    const contracts = await $query('Contract')
      .containedIn('company', companies)
      .notEqualTo('dueDays', 30)
      .find({ useMasterKey: true })
    if (!contracts.length) { break }
    for (const contract of contracts) {
      await contract.set('dueDays', 30).save(null, { useMasterKey: true })
    }
  }
  consola.info('contract due dates updated')

  // update all invoices
  while (true) {
    const invoices = await $query('Invoice')
      .containedIn('company', companies)
      .notEqualTo('dueDays', 30)
      .find({ useMasterKey: true })
    if (!invoices.length) { break }
    for (const invoice of invoices) {
      await invoice.set('dueDays', 30).save(null, { useMasterKey: true })
    }
  }
  consola.info('invoice due dates updated')
}
Parse.Cloud.define('manual-updates-update-company-due-days', () => {
  updateCompanyDueDates()
  return 'ok'
}, { requireMaster: true })
