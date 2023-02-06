const { setCubeOrderStatuses } = require('@/shared')

Parse.Cloud.define('manual-updates-set-cube-statuses', ({ params: { orderClass, orderId } }) => {
  return $getOrFail(orderClass, orderId).then(setCubeOrderStatuses)
}, { requireMaster: true })

Parse.Cloud.define('manual-updates-fix-ht-audits', async () => {
  const audits = await $query('Audit')
    .equalTo('itemClass', 'Cube')
    .equalTo('fn', 'cube-update')
    .notEqualTo('data.changes.htId', null)
    .limit(1000)
    .find({ useMasterKey: true })
  let i = 0
  for (const audit of audits) {
    const [before, after] = audit.get('data').changes.htId
    if (before !== after) {
      continue
    }
    consola.info('found same', before, after)
    const data = audit.get('data')
    data.changes.htId[0] = null
    audit.set('data', data)
    await audit.save(null, { useMasterKey: true })
    i++
  }
  return i
}, { requireMaster: true })
