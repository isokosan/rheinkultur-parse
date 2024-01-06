const { round } = require('lodash')

module.exports = async function (job) {
  const query = $query('Invoice')
    .equalTo('lexId', null)
    .equalTo('status', 1)
    .lessThanOrEqualTo('date', await $today())
  const total = await query.count({ useMasterKey: true })
  let i = 0
  while (true) {
    const invoice = await query.ascending('date').select('objectId').first({ useMasterKey: true })
    if (!invoice) {
      return Promise.resolve({ issuedInvoices: i })
    }
    // when email is true the email from invoice address will be used, (if order does not have skipInvoiceEmails)
    await Parse.Cloud.run('invoice-issue', { id: invoice.id, email: !DEVELOPMENT }, { useMasterKey: true })
    // wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000))
    consola.info('issued invoice', invoice.id)
    i++
    job.progress(round(100 * i / total))
  }
}
