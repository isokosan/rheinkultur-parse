const Queue = require('bull')
const path = require('path')
const { parse: parseRedisInfo } = require('redis-info')
const { getRedisOptions, getRedisClient } = require('@/services/redis')
const sendMail = require('@/services/email')

const isDev = process.env.NODE_ENV === 'development'
const tz = 'Europe/Berlin'

let subscriber
let client

const queueOptions = {
  prefix: `{${process.env.APP_ID}}`,
  metrics: {
    maxDataPoints: 60 * 24 * 7 // 1 week
  },
  settings: {
    maxStalledCount: 0
  }
}
if (process.env.REDIS_MODE === 'cluster') {
  queueOptions.createClient = function (type) {
    if (type === 'client') {
      if (!client) {
        client = getRedisClient({ db: 3 })
      }
      return client
    }
    if (type === 'subscriber') {
      if (!subscriber) {
        subscriber = getRedisClient({ db: 3 })
      }
      return subscriber
    }
    if (type === 'bclient') {
      return getRedisClient({ db: 3 })
    }
    throw new Error(`Unexpected connection type: ${type}`)
  }
} else {
  queueOptions.redis = getRedisOptions({ db: 3 })
}

const createQueue = key => new Queue(key, queueOptions)

// these are the default values, and will be overwritten by Parse Config values if defined.
const updateJobs = {
  free_early_canceled_cubes: {
    name: 'Frühzeitig stornierte CityCubes sync.',
    description: 'Frees city cubes that have been early canceled and the date is now past',
    timeoutMinutes: 30,
    cron: '0 1 * * *', // nightly at 01:00
    notificationDuration: 48
  },
  end_extend: {
    name: 'Verträge/Buchungen beenden/verlängern (außer Kinetic).',
    description: 'Verlängert nur die Verträge, die eine E-Mail-Adresse haben.',
    timeoutMinutes: 120
    // cron: '0 0 * * *' // nightly
  },
  generate_disassembly_tasks: {
    name: 'Abbauliste generieren.',
    timeoutMinutes: 60,
    // cron: '0 0 * * *', // nightly
    notificationDuration: 48
  },
  issue_invoices: {
    name: 'Rechnungen mit heutigen Datum abschliessen.',
    timeoutMinutes: 120
    // cron: '0 * * * *' // hourly
  },
  send_issued_invoice_emails: {
    name: 'Versenden von E-Mails mit ausgestellten Rechnungen.',
    description: 'Sends emails with issued invoices, that have an email but none were sent. (Past 3 days)',
    timeoutMinutes: 120
    // cron: '0 * * * *' // hourly
  },
  reindex_cubes: {
    name: 'Suchindex von CityCubes aktualisieren',
    timeoutMinutes: 60,
    cron: '0 0 * * *', // nightly at midnight
    notificationDuration: 48
  },
  reindex_cities: {
    name: 'Suchindex von Orte aktualisieren',
    timeoutMinutes: 60,
    cron: '0 1 * * *', // nightly at 1 am
    notificationDuration: 48
  },
  reindex_streets: {
    name: 'Suchindex von Straßen aktualisieren',
    timeoutMinutes: 15,
    cron: '0 2 * * *', // nightly at 2 am
    notificationDuration: 48
  },
  reindex_fieldwork: {
    name: 'Suchindex von Feldarbeit aktualisieren',
    timeoutMinutes: 60,
    cron: '0 3 * * *', // nightly at 3 am
    notificationDuration: 48
  },
  recalculate_aldi_prices: {
    name: 'Aktualisierung von ALDI preisen.',
    timeoutMinutes: 15,
    cron: '15 2 * * *', // nightly at 2:15 am
    notificationDuration: 48
  },
  recalculate_future_contract_invoices: {
    name: 'Recalculate all future invoices from contracts.',
    timeoutMinutes: 60
  },
  lex_ensure: {
    name: 'Überprüfung von Lex-Office Synchronizierung',
    timeoutMinutes: 15,
    cron: '*/10 * * * *', // every 10 minutes
    notificationDuration: 2
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
  isDev && consola.error('job failed:', job.queue.name, error)
}
const queueOnError = function (error) {
  isDev && consola.error('queue errored:', error)
}
const queueOnCompleted = async function (job, result) {
  isDev && consola.success('job completed:', job.queue.name, result)
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
  if (debug === 'cron' && cron && isDev) {
    queue.add({}, {
      repeat: { tz, cron },
      timeout
    })
    return
  }
  if (debug === true) {
    queue.add({}, { timeout })
  }
  if (!isDev && cron) {
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
  queue.add({}, { timeout, attempts: 1, stalledInterval: 1000 })
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
    html += lateJobs.map(({ key, notificationDuration, lastCompletedTime }) => {
      return `
      <p><strong>${key}:</strong> (Hasn't run in the past ${notificationDuration} hour(s). Last completed on: ${lastCompletedTime ? lastCompletedTime.toString() : ''}</p>
      `
    }).join('')
    return sendMail({
      to: await getScheduleNotificationsEmailConfig(),
      subject: `${lateJobs.length} failing job${lateJobs.length > 1 ? 's' : ''}`,
      html
    })
  }
  return Promise.resolve(lateJobs)
}

module.exports = { createQueue, getLast }
