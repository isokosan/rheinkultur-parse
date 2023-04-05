const { round } = require('lodash')

module.exports = async function (job) {
  const query = $query('Invoice')
    .equalTo('lexId', null)
    .equalTo('status', 1)
    .lessThanOrEqualTo('date', await $today())
  const total = await query.count({ useMasterKey: true })
  let i = 0
  while (true) {
    const invoice = await query.ascending('date').first({ useMasterKey: true })
    if (!invoice) {
      return Promise.resolve({ issuedInvoices: i })
    }
    // when email is true the email from invoice address will be used
    await Parse.Cloud.run('invoice-issue', { id: invoice.id, email: !DEVELOPMENT }, { useMasterKey: true })
    consola.info('issued invoice', invoice.id)
    i++
    job.progress(round(100 * i / total))
  }
}
