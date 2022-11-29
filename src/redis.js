// https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
const Redis = require('ioredis')

const getNodes = () => process.env.REDIS_NODES.split(',').map(node => {
  const [host, port] = node.split(':')
  return { host, port }
})

const getRedisOptions = ({ db } = {}) => {
  if (!db) { db = process.env.REDIS_DB || 0 }

  if (process.env.REDIS_SENTINELS) {
    return {
      sentinels: process.env.REDIS_SENTINELS.split(',').map((sentinel) => {
        const [host, port] = sentinel.split(':')
        return { host, port }
      }),
      name: process.env.REDIS_NAME,
      password: process.env.REDIS_PASS,
      db
    }
  }
  if (process.env.REDIS_MODE === 'cluster') {
    throw new Error('get redis options should not run in cluster mode')
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: process.env.REDIS_PORT ?? 6379,
    password: process.env.REDIS_PASS,
    username: process.env.REDIS_USER,
    db,
    enableReadyCheck: false,
    maxRetriesPerRequest: null
  }
}

const getClusterOptions = () => ({
  redisOptions: {
    password: process.env.REDIS_PASS,
    username: process.env.REDIS_USER,
    maxRetriesPerRequest: null
  },
  enableReadyCheck: false,
  enableAutoPipelining: true,
  enableOfflineQueue: false,
  natMap: process.env.NODE_ENV === 'development'
    ? {
      '10.5.0.2:6479': { host: '127.0.0.1', port: 6479 },
      '10.5.0.3:6479': { host: '127.0.0.1', port: 6480 },
      '10.5.0.4:6479': { host: '127.0.0.1', port: 6481 },
      '10.5.0.5:6479': { host: '127.0.0.1', port: 6482 },
      '10.5.0.6:6479': { host: '127.0.0.1', port: 6483 },
      '10.5.0.7:6479': { host: '127.0.0.1', port: 6487 }
    }
    : undefined
})

const getRedisClient = () => process.env.REDIS_MODE === 'cluster'
  ? new Redis.Cluster(getNodes(), getClusterOptions())
  : new Redis(getRedisOptions())

class PubSubAdapter {
  constructor () {
    this.pub = getRedisClient()
    this.sub = getRedisClient()
  }

  createPublisher () {
    return this.pub
  }

  createSubscriber () {
    return this.sub
  }
}

const redis = getRedisClient()

const awaitConnection = async () => {
  while (redis.status !== 'ready') {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}

module.exports = redis
module.exports.awaitConnection = awaitConnection
module.exports.getRedisOptions = getRedisOptions
module.exports.getRedisClient = getRedisClient
module.exports.pubSubAdapter = new PubSubAdapter()
