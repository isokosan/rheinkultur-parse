const Queue = require('bull')
const { getRedisOptions, getRedisClient } = require('@/services/redis')

const queueOptions = {
  prefix: `{${process.env.APP_ID}}`,
  metrics: {
    maxDataPoints: 60 * 24 * 7 // 1 week
  },
  settings: {
    maxStalledCount: 0
  }
}

let subscriber
let client

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

module.exports = createQueue
