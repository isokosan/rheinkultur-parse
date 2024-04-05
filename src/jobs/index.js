const path = require('path')
const { parse: parseRedisInfo } = require('redis-info')
const createQueue = require('@/services/bull')
const sendMail = require('@/services/email')
const tz = 'Europe/Berlin'

// IMPORTANT: Pods might be killed between 10:00PM and 03:00AM. Make sure jobs run between 03-06 AM

// these are the default values, and will be overwritten by Parse Config values if defined.
const updateJobs = {
  sync_cube_statuses: {
    name: 'Sync Cube Statuses',
    cron: '0 3 * * *', // at 03:00 AM
    timeoutMinutes: 60,
    notificationDuration: 24
  },
  calculate_stats: {
    name: 'Monatliche Statistiken',
    cron: '0 4 * * *', // at 04:00 AM
    timeoutMinutes: 30,
    notificationDuration: 24
  },
  reindex_cities: {
    name: 'Suchindex von Orte aktualisieren',
    timeoutMinutes: 30,
    cron: '0 4 * * *', // at 04:00 AM
    notificationDuration: 24
  },
  sync_disassemblies: {
    name: 'Demontage synchronizieren.',
    timeoutMinutes: 120,
    cron: '0 4 * * *', // at 04:00 AM
    notificationDuration: 24
  },
  reindex_streets: {
    name: 'Suchindex von Straßen aktualisieren',
    timeoutMinutes: 10,
    cron: '30 4 * * *', // at 04:30 AM
    notificationDuration: 24
  },
  reindex_fieldwork: {
    name: 'Suchindex von Dienseistungen aktualisieren',
    timeoutMinutes: 20,
    cron: '40 4 * * *', // at 04:40 AM
    notificationDuration: 24
  },
  reindex_bookings: {
    name: 'Suchindex von Buchungen aktualisieren',
    timeoutMinutes: 10,
    cron: '0 5 * * *', // at 05:00 AM
    notificationDuration: 24
  },
  reindex_booking_requests: {
    name: 'Suchindex von Buchungsanfragen aktualisieren',
    timeoutMinutes: 10,
    cron: '10 5 * * *', // at 05:10 AM
    notificationDuration: 24
  },
  reindex_frame_mounts: {
    name: 'Suchindex von Moskitorahmen aktualisieren',
    timeoutMinutes: 10,
    cron: '10 5 * * *', // at 05:10 AM
    notificationDuration: 24
  },
  recalculate_aldi_prices: {
    name: 'Aktualisierung von ALDI preisen.',
    timeoutMinutes: 10,
    cron: '20 5 * * *', // at 05:20 AM
    notificationDuration: 24
  },
  reindex_cubes: {
    name: 'Suchindex von CityCubes aktualisieren',
    timeoutMinutes: 120,
    cron: '0 6 * * *', // at 06:00 AM
    notificationDuration: 24
  },
  notify_scouts: {
    name: 'Benachrichtigung von Scouts in Abfahrslisten die heute starten',
    timeoutMinutes: 120,
    cron: '0 8 * * *', // at 06:00 AM
    notificationDuration: 24
  },
  system_status_vouchers: {
    name: 'Überprüfung von Nummernkreisen',
    timeoutMinutes: 2,
    cron: '*/10 * * * *', // every 10 minutes
    notificationDuration: 1
  },
  system_status_duplicate_invoices: {
    name: 'Überprüfung von Duplizierte Rechnungen',
    timeoutMinutes: 5,
    cron: '0/10 * * * *', // every 10 minutes
    notificationDuration: 1
  },
  lex_ensure: {
    name: 'Überprüfung von Lex-Office Synchronizierung',
    timeoutMinutes: 15,
    cron: '*/10 * * * *', // every 10 minutes
    notificationDuration: 1
  },
  // end_extend_contracts: {
  //   name: 'Verträge beenden/verlängern (außer Kinetic).',
  //   description: 'Verlängert nur die Verträge, die eine E-Mail-Adresse haben.',
  //   timeoutMinutes: 120
  // },
  // end_extend_bookings: {
  //   name: 'Buchungen beenden/verlängern. (Vertriebspartner)',
  //   description: 'Verlängert oder beendet Buchungen, die ihre Enddatum überschritten haben.',
  //   timeoutMinutes: 120
  // },
  recalculate_future_contract_invoices: {
    name: 'Recalculate all future invoices from contracts.',
    timeoutMinutes: 60
  },
  issue_invoices: {
    name: 'Rechnungen mit heutigen Datum abschliessen.',
    timeoutMinutes: 120
  },
  send_issued_invoice_emails: {
    name: 'Versenden von E-Mails mit ausgestellten Rechnungen.',
    description: 'Sends emails with issued invoices, that have an email but none were sent. (Past 3 days)',
    timeoutMinutes: 120
  },
  sync_flags: {
    name: 'Sync Flags',
    timeoutMinutes: 120
  }
}

const getScheduleConfig = async function () {
  const config = await Parse.Config.get()
  return config.get('schedule') || {}
}

const getScheduleNotificationsEmailConfig = async function () {
  const config = await Parse.Config.get()
  return config.get('scheduleNotificationsEmail') || config.get('mailToDevelopment')
}

Parse.Cloud.define('setScheduleNotificationsEmailConfig', function ({ params: { scheduleNotificationsEmail } }) {
  return Parse.Config.save({ scheduleNotificationsEmail })
}, $adminOnly)

let healthQueue
const updateQueues = {}
for (const key of Object.keys(updateJobs)) {
  if (!DEVELOPMENT && updateJobs[key].onlyDev) {
    continue
  }
  updateQueues[key] = createQueue(key)
}

const queueOnFailed = function (job, error) {
  DEVELOPMENT && consola.error('job failed:', job.queue.name, error)
}
const queueOnError = function (error) {
  DEVELOPMENT && consola.error('queue errored:', error)
}
const queueOnCompleted = async function (job, result) {
  DEVELOPMENT && consola.success('job completed:', job.queue.name, result)
  // save the last completed info on the job config
  const key = job.queue.name
  const { finishedOn, processedOn } = job
  const schedule = await getScheduleConfig()
  if (!(key in schedule)) {
    schedule[key] = {}
  }
  schedule[key].lastCompleted = { finishedOn, processedOn, result }
  return Parse.Config.save({ schedule })
}

const cleanAndStartupQueue = async function ({ schedule, key }) {
  schedule = schedule || await getScheduleConfig()
  const queue = updateQueues[key]
  const {
    debug,
    cron: defaultCron,
    timeoutMinutes: defaultTimeoutMinutes
  } = updateJobs[key]
  const cron = (schedule[key] || {}).cron || defaultCron
  const timeoutMinutes = (schedule[key] || {}).timeoutMinutes || defaultTimeoutMinutes
  const timeout = 1000 * 60 * timeoutMinutes
  await clearScheduledJobs(queue)
  if (debug === 'cron' && cron && DEVELOPMENT) {
    queue.add({}, {
      repeat: { tz, cron },
      timeout
    })
    return
  }
  if (debug === true) {
    queue.add({}, { timeout })
  }
  if (!DEVELOPMENT && cron) {
    queue.add({}, {
      repeat: { tz, cron },
      timeout,
      removeOnComplete: {
        age: 60 * 60 * 24 * 7 // 7 days
      },
      removeOnFail: {
        age: 60 * 60 * 24 * 14 // 14 days
      }
    })
  }
}

const startScheduler = async function () {
  const schedule = await getScheduleConfig()
  for (const key of Object.keys(updateQueues)) {
    const queue = updateQueues[key]
    updateJobs[key].separateProcess
      ? queue.process(path.join(__dirname, `/${key}/index.js`))
      : queue.process(require(`./${key}`))
    queue.on('failed', queueOnFailed)
    queue.on('error', queueOnError)
    queue.on('completed', queueOnCompleted)
    await cleanAndStartupQueue({ schedule, key })
  }
  if (DEVELOPMENT) { return }
  // setup the health queue
  healthQueue = createQueue('schedule_health')
  await clearScheduledJobs(healthQueue)
  healthQueue.process(checkScheduleHealth)
  healthQueue.on('failed', queueOnFailed)
  healthQueue.on('error', queueOnError)
  healthQueue.on('completed', queueOnCompleted)
  healthQueue.add({}, {
    repeat: { tz, cron: '0 * * * *' }, // hourly
    timeout: 1000 * 60 // one minute
  })
}

const clearScheduledJobs = async function (queue) {
  const jobs = await queue.getRepeatableJobs()
  for (const job of jobs) {
    await queue.removeRepeatableByKey(job.key)
  }
}

startScheduler()

Parse.Cloud.define('triggerScheduledJob', async function ({ params: { job } }) {
  // if job is already running return false
  const queue = updateQueues[job]
  const [activeJob] = await queue.getActive()
  if (activeJob) { return false }
  const [waitingJob] = await queue.getWaiting()
  if (waitingJob) { return false }
  const { timeoutMinutes } = updateJobs[job]
  const timeout = 1000 * 60 * timeoutMinutes
  queue.add({}, { timeout, attempts: 1 })
  return true
}, {
  fields: {
    job: {
      required: true,
      type: String,
      options: value => value in updateQueues,
      error: 'Invalid job'
    }
  },
  ...$adminOnly
})

Parse.Cloud.define('getScheduleData', async function () {
  const queue = Object.values(updateQueues)[0]
  const redisClient = await queue.client
  const redisInfoRaw = await redisClient.info()
  const redisInfo = parseRedisInfo(redisInfoRaw)
  const scheduleNotificationsEmail = await getScheduleNotificationsEmailConfig()
  return { redisInfo, scheduleNotificationsEmail }
}, $adminOnly)

Parse.Cloud.define('fetchQueues', async function () {
  const schedule = await getScheduleConfig()
  return Promise.all(Object.keys(updateQueues).map(async (key) => {
    const queue = updateQueues[key]
    const { last, lastCompletedOn } = await getLast(queue)
    const job = {
      key,
      ...updateJobs[key],
      // get the default set here
      cronDefault: updateJobs[key].cron,
      ...(schedule[key] || {}),
      counts: await queue.getJobCounts(),
      last,
      lastCompletedOn
    }
    if (job.last?.status === 'active') {
      job.runningId = job.last.id
    }
    // calculate passed notification date
    // job is late when the difference is greater than or equal to one hour
    job.lastCompletedOn = job.lastCompleted
      ? job.lastCompleted.finishedOn
      : job.lastCompletedOn
    const lastCompletedHoursAgo = moment().diff(moment(job.lastCompletedOn), 'hours')
    if (job.notificationDuration && lastCompletedHoursAgo) {
      const late = lastCompletedHoursAgo - job.notificationDuration
      if (late > 0) {
        job.late = late
      }
    }
    return job
  }))
}, $adminOnly)

const getLast = async function (queue) {
  let last = null
  const lastJobs = await queue.getJobs(['active', 'failed', 'completed'], 0, 0)
  if (!lastJobs.length) {
    return { last }
  }
  lastJobs.sort((a, b) => b.timestamp - a.timestamp)
  const lastCompleted = lastJobs.filter(j => j.finishedOn && !j.failedReason)[0]
  const lastCompletedOn = lastCompleted ? lastCompleted.finishedOn : null
  const { id, returnvalue, failedReason, stacktrace, finishedOn, processedOn, attemptsMade, _progress } = lastJobs[0]
  if (failedReason) {
    last = {
      id,
      status: 'failed',
      failedReason,
      stacktrace,
      attemptsMade,
      finishedOn,
      processedOn
    }
  } else if (finishedOn) {
    last = {
      id,
      status: 'completed',
      returnvalue,
      finishedOn,
      processedOn
    }
  } else {
    last = {
      id,
      status: 'active',
      progress: _progress,
      processedOn
    }
  }
  return { last, lastCompletedOn }
}

Parse.Cloud.define('clearQueue', function ({ params: { key, status } }) {
  const queue = updateQueues[key]
  return queue.clean(5000, status)
}, $adminOnly)

Parse.Cloud.define('obliterateQueue', function ({ params: { key } }) {
  const queue = updateQueues[key]
  return queue.obliterate({ force: true })
}, $adminOnly)

Parse.Cloud.define('cancelJob', async function ({ params: { key, jobId } }) {
  const queue = updateQueues[key]
  const job = await queue.getJob(jobId)
  await job.moveToFailed(Error('Job wurde manuell abgebrochen.'), true)
  return job.discard()
}, $adminOnly)

Parse.Cloud.define('saveSchedule', async function ({ params: { key, name, description, cron, timeoutMinutes, notificationDuration } }) {
  const config = await Parse.Config.get()
  const schedule = config.get('schedule') || {}
  schedule[key] = { name, description, cron, timeoutMinutes, notificationDuration }
  await cleanAndStartupQueue({ schedule, key })
  return Parse.Config.save({ schedule })
}, $adminOnly)

const checkScheduleHealth = async function () {
  const jobs = await Parse.Cloud.run('fetchQueues', {}, { useMasterKey: true })
  // send email to notify failing jobs that just went over the notification duration (only in the first hour)
  const lateJobs = jobs.filter(({ late }) => late === 1)
  if (lateJobs.length) {
    let html = '<p>The following jobs have not successfully completed within their allowed durations:</p>'
    html += lateJobs.map(({ key, notificationDuration, lastCompletedOn }) => {
      return `
      <p><strong>${key}:</strong> (Hasn't run in the past ${notificationDuration} hour(s). Last completed on: ${lastCompletedOn ? moment(lastCompletedOn).format('DD.MM.YYYY HH:mm') : '-'}</p>
      `
    }).join('')
    return sendMail({
      to: await getScheduleNotificationsEmailConfig(),
      bcc: null,
      subject: `${lateJobs.length} failing job${lateJobs.length > 1 ? 's' : ''}`,
      html
    })
  }
  return Promise.resolve(lateJobs)
}

Parse.Cloud.define('queue-jobs', async ({ params: { key } }) => {
  const queue = updateQueues[key]
  const jobs = await queue.getJobs(['active', 'failed', 'completed'], 0, 0)
    .then(jobs => jobs.map((job) => {
      delete job.opts
      delete job.queue
      return job
    }))

  consola.info(jobs)
  return jobs
}, $adminOnly)
