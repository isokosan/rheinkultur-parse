const PLZ = Parse.Object.extend('PLZ')
const redis = require('@/services/redis')

async function syncBlacklistCubeFlags (plz, isBlacklisted) {
  let i = 0
  const cubesQuery = $query('Cube').equalTo('plz', plz)
  isBlacklisted
    ? cubesQuery.notEqualTo('flags', 'bPLZ')
    : cubesQuery.equalTo('flags', 'bPLZ')
  await cubesQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const flags = cube.get('flags') || []
      cube.set('flags', isBlacklisted
        ? [...flags, 'bPLZ']
        : flags.filter(flag => flag !== 'bPLZ')
      )
      await $saveWithEncode(cube, null, { useMasterKey: true })
      i++
    }
  }, { useMasterKey: true })
  console.log('SET BLACKLIST PLZS', plz, i)
  return i
}

Parse.Cloud.beforeSave(PLZ, async ({ object: plz, context: { skipSyncCubes } }) => {
  if (plz.id.length !== 5) {
    throw new Error('PLZ sollte 5 Zeichen lang sein.')
  }
  const isBlacklisted = Boolean(plz.get('nMR'))
  await redis[isBlacklisted ? 'sadd' : 'srem']('blacklisted-plzs', plz.id)
  if (skipSyncCubes) { return }
  await syncBlacklistCubeFlags(plz.id, isBlacklisted)
})

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
// const cacheBlacklistedPlzs = () => $query('PLZ')
//   .equalTo('nMR', true)
//   .distinct('objectId', { useMasterKey: true })
//   .then(async (plzs) => {
//     consola.info('syncing blacklisted-plzs cache', plzs)
//     if (!plzs.length) return
//     return redis.sadd('blacklisted-plzs', plzs)
//   })

Parse.Cloud.define('plz-update', async ({ params: { id, nMR } }) => {
  const plz = await $getOrFail('PLZ', id)
  const isBlacklisted = Boolean(nMR)
  if (Boolean(plz.get('nMR')) === isBlacklisted) {
    return `PLZ ${plz.id} ist bereits ${isBlacklisted ? 'blacklisted' : 'whitelisted'}.`
  }
  await plz
    .set('nMR', isBlacklisted)
    .save(null, { useMasterKey: true, context: { skipSyncCubes: true } })
  const updatedCubes = await syncBlacklistCubeFlags(id, isBlacklisted)
  return {
    data: plz.toJSON(),
    message: `PLZ ${plz.id} gespeichert. ${updatedCubes} CityCubes aktualisiert.`
  }
}, $adminOnly)

module.exports = { syncBlacklistCubeFlags }
