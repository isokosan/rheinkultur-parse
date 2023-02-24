const path = require('path')
const { ensureUniqueField } = require('@/utils')
const { createQueue, getLast } = require('@/cloud/jobs')
const { getQuarterStartEnd } = require('@/shared')

const QuarterlyReport = Parse.Object.extend('QuarterlyReport')

async function checkIfQuarterIsClosed (quarter) {
  const { start, end } = getQuarterStartEnd(quarter)
  const [contracts, bookings, invoices] = await Promise.all([
    // check contracts ended / extended
    $query('Contract')
      .equalTo('status', 3) // aktiv
      .lessThanOrEqualTo('endsAt', end)
      .count({ useMasterKey: true }),
    // check bookings ended / extended
    $query('Booking')
      .equalTo('status', 3) // aktiv
      .lessThanOrEqualTo('endsAt', end)
      .count({ useMasterKey: true }),
    // check invoices issued
    $query('Invoice')
      .lessThan('status', 2)
      .greaterThan('periodEnd', start)
      .lessThanOrEqualTo('periodStart', end)
      .count({ useMasterKey: true })
    // TODO: Check if Marc Asriel quarterly invoice is issued
  ])
  if (contracts || bookings || invoices) {
    throw new Error(`Quartal ${quarter} ist noch nicht geschlossen.`)
  }
}

const reportQueue = createQueue('process_quarterly_report')
reportQueue.process(path.join(BASE_DIR, 'queues/index.js'))
reportQueue.obliterate({ force: true })
  .then(response => consola.success('obliterated', response))
  .then(() => reportQueue.getJobs())
  .then(response => consola.info('jobs', response))

Parse.Cloud.beforeSave(QuarterlyReport, async ({ object: quarterlyReport }) => {
  await ensureUniqueField(quarterlyReport, 'quarter')
})

Parse.Cloud.beforeFind(QuarterlyReport, ({ query }) => {
  !query._include.includes('rows') && query.exclude('rows')
})

Parse.Cloud.define('quarterly-report-retrieve', async ({ params: { quarter } }) => {
  const report = await $query('QuarterlyReport')
    .equalTo('quarter', quarter)
    .descending('createdAt')
    .first({ useMasterKey: true })
  return report || checkIfQuarterIsClosed(quarter)
}, $adminOrMaster)

Parse.Cloud.define('job-start', () => reportQueue.add({ id: 'L6OJ4k2Uo3' }).then(job => job.id), $adminOrMaster)

Parse.Cloud.define('job-status', async ({ params: { jobId } }) => {
  const job = await reportQueue.getJob(jobId)
  return { last: await getLast(reportQueue), jobProgress: job.progress() }
}, $adminOrMaster)

Parse.Cloud.define('quarterly-report-generate', async ({ params: { quarter } }) => {
  const report = await $query('QuarterlyReport')
    .equalTo('quarter', quarter)
    .descending('createdAt')
    .first({ useMasterKey: true })
  if (!report) {
    throw new Error(`Quarter ${quarter} not found.`)
  }
  if (report.get('jobId')) {
    throw new Error('Job already added')
  }
  reportQueue.add({ id: report.id })
  return 'processing quarter ' + quarter
}, $adminOrMaster)
