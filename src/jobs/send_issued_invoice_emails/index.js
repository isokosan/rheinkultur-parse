const { round } = require('lodash')

module.exports = async function (job) {
  let total = null
  let i = 0
  const today = await $today()
  while (true) {
    const { count, results: invoices } = await $query('Invoice')
      .notEqualTo('lexId', null)
      .equalTo('status', 2)
      .equalTo('mailStatus', null)
      .equalTo('postStatus', null)
      .matchesQuery('address', $query('Address').notEqualTo('email', null))
      .doesNotMatchQuery('contract', $query('Contract').equalTo('skipInvoiceEmails', true))
      .greaterThanOrEqualTo('date', moment(today).subtract(3, 'days').format('YYYY-MM-DD'))
      .ascending('date')
      .withCount()
      .include('address')
      .find({ useMasterKey: true })
    if (total === null) {
      total = count
    }
    if (!invoices.length) {
      return Promise.resolve({ sentEmails: i })
    }
    for (const invoice of invoices) {
      const email = invoice.get('address').get('email')
      await Parse.Cloud.run('invoice-send-mail', { id: invoice.id, email }, { useMasterKey: true })
      i++
      job.progress(round(100 * i / total))
    }
  }
}
