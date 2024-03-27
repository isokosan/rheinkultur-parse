const PLZ = Parse.Object.extend('PLZ')
const redis = require('@/services/redis')

async function syncBlacklistCubeFlags (plz) {
  let i = 0
  for (const pk of plz.get('pks')) {
    const cubesQuery = $query('Cube')
      .equalTo('plz', plz.id)
      .equalTo('pk', pk)
    const isBlacklisted = plz.get('blk')?.includes(pk)
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
  }
  console.log('SET BLACKLIST PLZS', plz, i)
  return i
}

Parse.Cloud.beforeSave(PLZ, async ({ object: plz, context: { skipSyncCubes } }) => {
  if (plz.id.length !== 5) {
    throw new Error('PLZ sollte 5 Zeichen lang sein.')
  }
  plz.get('blk') && !plz.get('blk').length && plz.unset('blk')
  for (const pk of plz.get('pks')) {
    const isBlacklisted = plz.get('blk')?.includes(pk)
    await redis[isBlacklisted ? 'sadd' : 'srem']('blacklisted-plzs', plz.id + ':' + pk)
  }
  if (skipSyncCubes) { return }
  await syncBlacklistCubeFlags(plz)
})

Parse.Cloud.afterFind(PLZ, async ({ objects, query }) => {
  if (query._include.includes('cubeCount')) {
    for (const plz of objects) {
      plz.set('cubeCount', await $query('Cube').equalTo('plz', plz.id).count({ useMasterKey: true }))
    }
  }
})

Parse.Cloud.afterDelete(PLZ, ({ object: plz }) => {
  for (const pk of plz.get('pks')) {
    redis.srem('blacklisted-plzs', plz.id + ':' + pk)
  }
})

Parse.Cloud.define('plz-update', async ({ params: { id, blk } }) => {
  const plz = await $getOrFail('PLZ', id)
  for (const pk of plz.get('pks')) {
    await redis[blk.includes(pk) ? 'sadd' : 'srem']('blacklisted-plzs', plz.id + ':' + pk)
  }
  plz.set('blk', blk)
  await plz.save(null, { useMasterKey: true, context: { skipSyncCubes: true } })
  const updatedCubes = await syncBlacklistCubeFlags(plz)
  return {
    data: plz.toJSON(),
    message: `PLZ ${plz.id} gespeichert. ${updatedCubes} CityCubes aktualisiert.`
  }
}, $adminOnly)

module.exports = { syncBlacklistCubeFlags }
