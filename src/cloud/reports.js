const { processMediaInvoices, mapReportRow } = require('@/report-helpers')

Parse.Cloud.define('agency-monthly', async ({ params: { agencyId, yearMonth } }) => {
  const agency = await $query('Company').equalTo('objectId', agencyId).first({ useMasterKey: true })
  if (!agency) { return [] }
  const [year, month] = yearMonth.split('-')
  console.log(yearMonth, year, month, agency)
  const start = moment().year(year).month(month - 1).startOf('month').format('YYYY-MM-DD')
  const end = moment().year(year).month(month - 1).endOf('month').format('YYYY-MM-DD')
  const rows = await processMediaInvoices(start, end, agency)
    .then(rows => Promise.all(rows.map(mapReportRow)))
  return rows
}, $adminOnly)
