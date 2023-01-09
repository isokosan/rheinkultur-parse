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
  maxStalledCount: 0,
  metrics: {
    maxDataPoints: 60 * 24 * 7 // 1 week
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
  // end_extend: {
  //   name: 'Verträge/Buchungen beenden/verlängern.',
  //   timeoutMinutes: 30
  //   // cron: '0 0 * * *' // nightly
  // },
  // issue_invoices: {
  //   name: 'Rechnungen mit heutigen Datum abschliessen.',
  //   timeoutMinutes: 120
  //   // cron: '0 * * * *' // hourly
  // },
  reindex_autocompletes: {
    name: 'Aktualisierung von Suchindexen (Straßen und Orte).',
    timeoutMinutes: 15,
    cron: '0 0 * * *', // nightly
    notificationDuration: 48
  },
  reindex_search: {
    name: 'Aktualisierung von Suchindexen (CityCubes).',
    timeoutMinutes: 60,
    cron: '0 0 * * *', // nightly
    notificationDuration: 48
  },
  lex_ensure: {
    name: 'Überprüfung von Lex-Office Synchronizierung',
    timeoutMinutes: 15,
    cron: '*/10 * * * *',
    notificationDuration: 1
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
}, $adminOrMaster)

let healthQueue
const updateQueues = {}
for (const key of Object.keys(updateJobs)) {
  if (process.env.PARSE_SERVER_MODE === 'production' && updateJobs[key].onlyDev) {
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
  if (activeJob) {
    return false
  }
  const { timeoutMinutes } = updateJobs[job]
  const timeout = 1000 * 60 * timeoutMinutes
  queue.add({}, { timeout })
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
  ...$adminOrMaster
})

Parse.Cloud.define('getScheduleData', async function () {
  const queue = Object.values(updateQueues)[0]
  const redisClient = await queue.client
  const redisInfoRaw = await redisClient.info()
  const redisInfo = parseRedisInfo(redisInfoRaw)
  const scheduleNotificationsEmail = await getScheduleNotificationsEmailConfig()
  return { redisInfo, scheduleNotificationsEmail }
}, $adminOrMaster)

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
}, $adminOrMaster)

const getLast = async function (queue) {
  let last
  const lastJobs = await queue.getJobs(['active', 'failed', 'completed'], 0, 0)
  if (!lastJobs.length) {
    return { last }
  }
  lastJobs.sort((a, b) => b.timestamp - a.timestamp)
  const lastCompleted = lastJobs.filter(j => j.finishedOn && !j.failedReason)[0]
  const lastCompletedOn = lastCompleted ? lastCompleted.finishedOn : null
  const { returnvalue, failedReason, stacktrace, finishedOn, processedOn, attemptsMade, _progress } = lastJobs[0]
  if (failedReason) {
    last = {
      status: 'failed',
      failedReason,
      stacktrace,
      attemptsMade,
      finishedOn,
      processedOn
    }
  } else if (finishedOn) {
    last = {
      status: 'completed',
      returnvalue,
      finishedOn,
      processedOn
    }
  } else {
    last = {
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
}, $adminOrMaster)

Parse.Cloud.define('saveSchedule', async function ({ params: { key, name, description, cron, timeoutMinutes, notificationDuration } }) {
  const config = await Parse.Config.get()
  const schedule = config.get('schedule') || {}
  schedule[key] = { name, description, cron, timeoutMinutes, notificationDuration }
  await cleanAndStartupQueue({ schedule, key })
  return Parse.Config.save({ schedule })
}, $adminOrMaster)

const checkScheduleHealth = async function () {
  const jobs = await Parse.Cloud.run('fetchQueues', {}, { useMasterKey: true })
  // send email to notify failing jobs that just went over the notification duration (only in the first hour)
  const lateJobs = jobs.filter(({ late }) => late === 1)
  if (lateJobs.length) {
    let html = '<p>The following jobs have not successfully completed within their allowed durations:</p>'
    html += `<p><strong>Environment: ${process.env.PARSE_SERVER_MODE}</strong></p>`
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
