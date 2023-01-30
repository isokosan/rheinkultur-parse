// https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
const Redis = require('ioredis')
const LRU = require('lru-cache')
const isValidTTL = ttl => typeof ttl === 'number' && ttl > 0

// DATABASES
// 0: ParseCacheAdapter
// 1: Rheinkultur-WaWi Cache
// 2: PubSubAdapter
// 3: Bull-Queues
// 9: Rheinkultur Scouting

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
    db
    // enableReadyCheck: false,
    // maxRetriesPerRequest: null
  }
}

const getClusterOptions = ({ db } = {}) => ({
  redisOptions: {
    password: process.env.REDIS_PASS,
    username: process.env.REDIS_USER,
    maxRetriesPerRequest: null,
    db
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

const getRedisClient = ({ db } = {}) => process.env.REDIS_MODE === 'cluster'
  ? new Redis.Cluster(getNodes(), getClusterOptions({ db }))
  : new Redis(getRedisOptions({ db }))

class ParseCacheAdapter {
  constructor () {
    this.client = getRedisClient({ db: 0 })
    this.ttl = 30 * 1000
    this.map = new LRU({
      max: 1000,
      maxAge: 1000 * 60 /// 1 min
    })
  }

  chainPromise (key, promFunction) {
    let p = this.map.get(key)
    if (!p) {
      p = Promise.resolve()
    }
    p = p.then(promFunction)
    this.map.set(key, p)
    return p
  }

  get (key) {
    return this.chainPromise(
      key,
      () =>
        new Promise(resolve => {
          this.client.get(key, function (error, response) {
            if (!response || error) {
              return resolve(null)
            }
            resolve(JSON.parse(response))
          })
        })
    )
  }

  put (key, value, ttl = this.ttl) {
    value = JSON.stringify(value)
    if (ttl === 0) {
      return this.chainPromise(key, () => Promise.resolve())
    }

    if (ttl === Number.POSITIVE_INFINITY) {
      return this.chainPromise(
        key,
        () =>
          new Promise(resolve => {
            this.client.set(key, value, function () {
              resolve()
            })
          })
      )
    }

    if (!isValidTTL(ttl)) {
      ttl = this.ttl
    }

    return this.chainPromise(
      key,
      () =>
        new Promise(resolve => {
          if (ttl === Number.POSITIVE_INFINITY) {
            this.client.set(key, value, function () {
              resolve()
            })
          } else {
            this.client.psetex(key, ttl, value, function () {
              resolve()
            })
          }
        })
    )
  }

  del (key) {
    return this.chainPromise(
      key,
      () =>
        new Promise(resolve => {
          this.client.del(key, function () {
            resolve()
          })
        })
    )
  }

  clear () {
    return new Promise(resolve => {
      this.client.flushdb(function () {
        resolve()
      })
    })
  }

  async getAllKeys () {
    return new Promise((resolve, reject) => {
      this.client.keys('*', (error, keys) => {
        if (error) {
          reject(error)
        } else {
          resolve(keys)
        }
      })
    })
  }
}

class PubSubAdapter {
  constructor () {
    this.pub = getRedisClient({ db: 2 })
    this.sub = getRedisClient({ db: 2 })
  }

  createPublisher () {
    return this.pub
  }

  createSubscriber () {
    return this.sub
  }
}

const redis = getRedisClient({ db: 1 })

redis.on('connect', () => {
  consola.success('redis connected')
})
redis.on('ready', () => {
  consola.success('redis ready')
})
redis.on('error', (error) => {
  consola.error('redis errored', error)
})
redis.on('close', () => {
  consola.warn('redis closed')
})
redis.on('reconnecting', () => {
  consola.info('redis reconnecting')
})
redis.on('wait', () => {
  consola.info('redis waiting')
})

const awaitConnection = async () => {
  while (redis.status !== 'ready') {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}

module.exports = redis
module.exports.test = async () => {
  await redis.del('ping')
  const time = new Date().toISOString()
  await redis.set('ping', time)
  return time === await redis.get('ping')
}
module.exports.awaitConnection = awaitConnection
module.exports.getRedisOptions = getRedisOptions
module.exports.getRedisClient = getRedisClient
module.exports.pubSubAdapter = new PubSubAdapter()
module.exports.parseCacheAdapter = new ParseCacheAdapter()
