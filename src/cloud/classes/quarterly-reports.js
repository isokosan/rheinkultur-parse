const path = require('path')
const createQueue = require('@/services/bull')
const { ensureUniqueField } = require('@/utils')
const { getQuarterStartEnd } = require('@/shared')

const QuarterlyReport = Parse.Object.extend('QuarterlyReport')

const reportQueue = createQueue('process_quarterly_report')
reportQueue.process(path.join(BASE_DIR, 'queues/index.js'))
reportQueue.obliterate({ force: true }).then(response => consola.success('obliterated', response))
// reportQueue.getJobs().then(response => consola.info('jobs', response))

function validateQuarterYearString (str) {
  const regex = /^[1-4]-\d{4}$/
  if (!regex.test(str)) {
    throw new Error('Invalid quarter year string')
  }
}

Parse.Cloud.beforeSave(QuarterlyReport, async ({ object: quarterlyReport }) => {
  validateQuarterYearString(quarterlyReport.get('quarter'))
  await ensureUniqueField(quarterlyReport, 'quarter')
})

Parse.Cloud.beforeFind(QuarterlyReport, ({ query }) => {
  !query._include.includes('rows') && query.exclude('rows')
})

async function checkIfQuarterIsReportable (quarter) {
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
    return {
      contracts: contracts || undefined,
      bookings: bookings || undefined,
      invoices: invoices || undefined
    }
  }
  return true
}

Parse.Cloud.define('quarterly-report-retrieve', async ({ params: { quarter } }) => {
  const report = await $query(QuarterlyReport)
    .equalTo('quarter', quarter)
    .descending('createdAt')
    .first({ useMasterKey: true })
  if (!report) {
    const reportable = await checkIfQuarterIsReportable(quarter)
    if (reportable !== true) {
      return { reportable }
    }
    return { report: await new QuarterlyReport({ quarter }).save(null, { useMasterKey: true }) }
  }
  return { report }
}, $adminOnly)

Parse.Cloud.define('quarterly-report-generate', async ({ params: { quarter } }) => {
  const report = await $query(QuarterlyReport)
    .equalTo('quarter', quarter)
    .descending('createdAt')
    .first({ useMasterKey: true })
  if (!report) {
    throw new Error('Report not found')
  }
  if (report.get('jobId')) {
    throw new Error('Job already added')
  }
  const newJobId = await reportQueue.add({ id: report.id }).then(job => job.id)
  consola.warn('NEW JOB ID', newJobId)
  return newJobId
}, $adminOnly)

Parse.Cloud.define('quarterly-report-finalize', async ({ params: { quarter } }) => {
  const report = await $query(QuarterlyReport)
    .equalTo('quarter', quarter)
    .descending('createdAt')
    .first({ useMasterKey: true })
  if (!report) { throw new Error('Report not found') }
  if (report.get('status') !== 'draft') {
    throw new Error('Cannot finalize report in non-draft status')
  }
  return report.set('status', 'finalized').save(null, { useMasterKey: true })
}, $adminOnly)

Parse.Cloud.define('job-start', ({ params: { id } }) => reportQueue.add({ id }).then(job => job.id), $adminOnly)

Parse.Cloud.define('job-status', async ({ params: { jobId } }) => {
  const job = await reportQueue.getJob(jobId)
  if (!job) {
    throw new Error('Job not found')
  }
  consola.info(job)
  if (job.failedReason || job.stacktrace.length) {
    throw new Error({ message: job.failedReason, stacktrace: job.stacktrace })
  }
  return job?.progress()
}, $adminOnly)
