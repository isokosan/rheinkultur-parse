const redis = require('@/services/redis')

DEVELOPMENT && Parse.Cloud.define('goto', async ({ params: { date } }) => {
  if (!moment(date).isAfter(await $today(), 'day')) {
    throw new Error('Can only travel to the future.')
  }
  const today = moment(date).format('YYYY-MM-DD')
  return Parse.Config.save({ today })
})

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
