const path = require('path')
const createQueue = require('@/services/bull')
const { ensureUniqueField } = require('@/utils')
const { getQuarterStartEnd } = require('@/shared')

const QuarterlyReport = Parse.Object.extend('QuarterlyReport')

const reportQueue = createQueue('process_quarterly_report')
reportQueue.process(path.join(BASE_DIR, 'queues/index.js'))
reportQueue.obliterate({ force: true }).then(response => consola.success('obliterated', response))

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

async function getReportFinalizeIssues (quarter) {
  const { start, end } = getQuarterStartEnd(quarter)
  const issues = {}
  issues.contracts = await $query('Contract')
    .equalTo('status', 3) // aktiv
    .lessThanOrEqualTo('endsAt', end)
    .count({ useMasterKey: true })

  // make sure every partner has their quarter initialized
  // TODO: limit
  const partners = await $query('Company')
    .notEqualTo('distributor', null)
    .find({ useMasterKey: true })
  issues.partnerQuarters = await Promise.all(partners.map(async (company) => {
    const partnerQuarter = await Parse.Cloud.run('partner-quarter', { companyId: company.id, quarter }, { useMasterKey: true })
    if (partnerQuarter.status === 'finalized') {
      return null
    }
    return partnerQuarter
  })).then(partnerQuarters => partnerQuarters.filter(Boolean))

  issues.invoices = await $query('Invoice')
    .lessThan('status', 2)
    .greaterThan('periodEnd', start)
    .lessThanOrEqualTo('periodStart', end)
    .count({ useMasterKey: true })

  issues.creditNotes = await $query('CreditNote')
    .lessThan('status', 2)
    .greaterThan('periodEnd', start)
    .lessThanOrEqualTo('periodStart', end)
    .count({ useMasterKey: true })

  for (const key of Object.keys(issues)) {
    if (!issues[key].length) {
      delete issues[key]
    }
  }
  return $cleanDict(issues)
}

Parse.Cloud.define('quarterly-report-retrieve', async ({ params: { quarter } }) => {
  const report = await $query(QuarterlyReport)
    .equalTo('quarter', quarter)
    .descending('createdAt')
    .first({ useMasterKey: true }) || await new QuarterlyReport({ quarter }).save(null, { useMasterKey: true })
  if (report.get('status') !== 'finalized') {
    report.set('issues', await getReportFinalizeIssues(quarter))
    await report.save(null, { useMasterKey: true })
  }
  return report
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
  if (report.get('issues')) {
    throw new Error('Report has issues')
  }
  report.set('status', 'finalized')
  await report.save(null, { useMasterKey: true })
  return {
    data: report,
    message: 'Bericht finalisiert'
  }
}, $adminOnly)

Parse.Cloud.define('job-start', ({ params: { id } }) => reportQueue.add({ id }).then(job => job.id), $adminOnly)

Parse.Cloud.define('job-status', async ({ params: { jobId } }) => {
  const job = await reportQueue.getJob(jobId)
  if (!job) {
    throw new Error('Job not found')
  }
  if (job.failedReason || job.stacktrace.length) {
    consola.error(job.stacktrace)
    throw new Error(job.failedReason)
  }
  return job?.progress()
}, $adminOnly)
