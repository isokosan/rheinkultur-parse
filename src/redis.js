// https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
const Redis = require('ioredis')

const getRedisOptions = ({ db } = {}) => {
  if (process.env.url) { return process.env.url }
  if (!db) { db = process.env.REDIS_DB || 0 }

  if (process.env.REDIS_MODE === 'cluster') {
    if (!process.env.REDIS_NODES) {
      throw new Error('REDIS_NODES is not defined')
    }
    return {
      nodes: process.env.REDIS_NODES.split(',').map(node => {
        const [host, port] = node.split(':')
        return { host, port }
      }),
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        username: process.env.REDIS_USERNAME,
        maxRetriesPerRequest: null
      },
      enableReadyCheck: false,
      enableAutoPipelining: true,
      enableOfflineQueue: false,
      keyPrefix: process.env.APP_ID
    }
  }
  if (process.env.REDIS_MODE === 'sentinel') {
    if (!process.env.REDIS_NODES) {
      throw new Error('REDIS_NODES is not defined')
    }
    return {
      sentinels: process.env.REDIS_NODES.split(',').map(node => {
        const [host, port] = node.split(':')
        return { host, port }
      }),
      name: process.env.REDIS_MASTER_NAME ?? 'mymaster',
      password: process.env.REDIS_PASSWORD,
      username: process.env.REDIS_USERNAME,
      db: process.env.REDIS_DB ?? 0,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      keyPrefix: process.env.APP_ID
    }
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: process.env.REDIS_PORT ?? 6379,
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME,
    db,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    keyPrefix: process.env.APP_ID
  }
}

class PubSubAdapter {
  constructor (config) {
    this.pub = new Redis(config)
    this.sub = new Redis(config)
  }

  createPublisher () {
    return this.pub
  }

  createSubscriber () {
    return this.sub
  }
}

const redis = new Redis(getRedisOptions())

module.exports = redis
module.exports.getRedisOptions = getRedisOptions
module.exports.pubSubAdapter = new PubSubAdapter(getRedisOptions())
