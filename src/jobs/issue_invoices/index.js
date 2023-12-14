const { round } = require('lodash')

module.exports = async function (job) {
  const query = $query('Invoice')
    .equalTo('lexId', null)
    .equalTo('status', 1)
    .include('contract')
    .lessThanOrEqualTo('date', await $today())
  const total = await query.count({ useMasterKey: true })
  let i = 0
  while (true) {
    const invoice = await query.ascending('date').first({ useMasterKey: true })
    if (!invoice) {
      return Promise.resolve({ issuedInvoices: i })
    }
    // TODO: remove the email setter here and revert to email: !DEVELOPMENT after adding checks in invoices.js
    // Then you can remove the include contract above and only fetch ids
    let email = !DEVELOPMENT
    if (invoice.get('contract')?.get('skipInvoiceEmails')) {
      email = false
    }
    // when email is true the email from invoice address will be used
    await Parse.Cloud.run('invoice-issue', { id: invoice.id, email }, { useMasterKey: true })
    // wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000))
    consola.info('issued invoice', invoice.id)
    i++
    job.progress(round(100 * i / total))
  }
}
