const redis = require('@/services/redis')

Parse.Cloud.define('redis-test', async () => {
  let i = 0
  for (let plz = 10000; plz < 20000; plz++) {
    if (await redis.sismember('no-marketing-rights', `${plz}`) === 1) {
      i++
    }
    plz++
  }
  return i
}, { requireMaster: true })
