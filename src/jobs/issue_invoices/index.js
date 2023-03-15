const { round } = require('lodash')

module.exports = async function (job) {
  let total = null
  let i = 0
  const today = await $today()
  while (true) {
    const { count, results: invoices } = await $query('Invoice')
      .equalTo('lexId', null)
      .equalTo('status', 1)
      .lessThanOrEqualTo('date', today)
      .ascending('date')
      .withCount()
      .find({ useMasterKey: true })
    if (total === null) {
      total = count
    }
    if (!invoices.length) {
      return Promise.resolve({ issuedInvoices: i })
    }
    for (const invoice of invoices) {
      // when email is true the email from invoice address will be used
      await Parse.Cloud.run('invoice-issue', { id: invoice.id, email: !DEVELOPMENT }, { useMasterKey: true })
      i++
      job.progress(round(100 * i / total))
    }
  }
}
