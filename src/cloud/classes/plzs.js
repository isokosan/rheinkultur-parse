const PLZ = Parse.Object.extend('PLZ')
const redis = require('@/services/redis')

Parse.Cloud.beforeSave(PLZ, async ({ object: plz }) => {
  if (plz.id.length !== 5) {
    throw new Error('PLZ sollte 5 Zeichen lang sein.')
  }
})

Parse.Cloud.afterSave(PLZ, ({ object: plz }) => {
  plz.get('nMR')
    ? redis.sadd('no-marketing-rights', plz.id)
    : redis.srem('no-marketing-rights', plz.id)
})

Parse.Cloud.afterFind(PLZ, async ({ objects, query }) => {
  if (query._include.includes('cubeCount')) {
    for (const plz of objects) {
      plz.set('cubeCount', await $query('Cube').equalTo('plz', plz.id).count({ useMasterKey: true }))
    }
  }
})

Parse.Cloud.afterDelete(PLZ, ({ object: plz }) => {
  redis.srem('no-marketing-rights', plz.id)
})
