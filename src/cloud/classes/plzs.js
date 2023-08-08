const PLZ = Parse.Object.extend('PLZ')
const redis = require('@/services/redis')
const { indexCubes } = require('@/cloud/search')

Parse.Cloud.beforeSave(PLZ, async ({ object: plz }) => {
  if (plz.id.length !== 5) {
    throw new Error('PLZ sollte 5 Zeichen lang sein.')
  }
  await redis[plz.get('nMR') ? 'sadd' : 'srem']('blacklisted-plzs', plz.id)
})

Parse.Cloud.afterSave(PLZ, ({ object: plz }) => $query('Cube').equalTo('plz', plz.id).eachBatch(indexCubes, { useMasterKey: true }))

Parse.Cloud.afterFind(PLZ, async ({ objects, query }) => {
  if (query._include.includes('cubeCount')) {
    for (const plz of objects) {
      plz.set('cubeCount', await $query('Cube').equalTo('plz', plz.id).count({ useMasterKey: true }))
    }
  }
})

Parse.Cloud.afterDelete(PLZ, ({ object: plz }) => {
  redis.srem('blacklisted-plzs', plz.id)
})

// add all plzs to blacklisted-plzs upon pod start
$query('PLZ').equalTo('nMR', true).distinct('objectId', { useMasterKey: true })
  .then(plzs => redis.sadd('blacklisted-plzs', plzs))
  .then(() => consola.info('synced blacklisted-plzs'))
