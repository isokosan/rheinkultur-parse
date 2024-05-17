const Audit = Parse.Object.extend('Audit')

const FIELDWORK_FUNCTIONS = [
  'briefing-create',
  'briefing-update',
  'control-create',
  'control-update',
  'disassembly-sync',
  'task-list-create',
  'task-list-generate',
  'task-list-update',
  'task-list-appoint',
  'task-list-assign',
  'task-list-retract-appoint',
  'task-list-retract-assign',
  'task-list-complete',
  'task-list-retract-complete',
  'scout-submission-submit',
  'scout-submission-preapprove',
  'scout-submission-toggle-can-online-scout',
  'scout-submission-approve',
  'scout-submission-reject',
  'control-submission-submit',
  'control-submission-approve',
  'control-submission-reject',
  'disassembly-submission-submit',
  'disassembly-submission-approve',
  'disassembly-submission-preapprove',
  'disassembly-submission-reject',
  'disassembly-submission-update'
]

Parse.Cloud.beforeFind(Audit, async ({ query, user, master }) => {
  if (master) { return }
  if (!user || user.get('accType') === 'scout') { throw new Parse.Error(401, 'Unbefugter Zugriff') }

  if (!user.get('permissions')?.includes('manage-fieldwork')) {
    query.notContainedIn('fn', FIELDWORK_FUNCTIONS)
  }

  if (user.get('accType') === 'partner') {
    const orQueries = []
    if (user.get('permissions')?.includes('manage-scouts')) {
      const userIds = await $query(Parse.User)
        .equalTo('company', user.get('company'))
        .distinct('objectId', { useMasterKey: true })
      const users = userIds.map(id => $pointer(Parse.User, id))
      orQueries.push($query(Audit).containedIn('user', users))
    }
    if (user.get('permissions')?.includes('manage-bookings')) {
      const bookingIds = await $query('Booking')
        .equalTo('company', user.get('company'))
        .distinct('objectId', { useMasterKey: true })
      orQueries.push($query(Audit).equalTo('itemClass', 'Booking').containedIn('itemId', bookingIds))
    }
    if (user.get('permissions')?.includes('manage-frames')) {
      orQueries.push($query(Audit).equalTo('itemClass', 'FrameMount'))
    }
    if (!orQueries.length) {
      throw new Parse.Error(401, 'Unbefugter Zugriff')
    }
    return Parse.Query.and(
      query,
      Parse.Query.or(...orQueries)
    )
  }
})

Parse.Cloud.beforeSave(Audit, ({ object: audit }) => {
  const data = audit.get('data')
  if (data) {
    if (!Object.keys(data.changes || {}).length) {
      delete data.changes
    }
    if (!Object.keys(data.cubeChanges || {}).length) {
      delete data.cubeChanges
    }
    if (!Object.keys(data.productionChanges || {}).length) {
      delete data.productionChanges
    }
    Object.keys(data).length ? audit.set('data', data) : audit.unset('data')
  }
})

Parse.Cloud.afterFind(Audit, async ({ objects: audits }) => {
  const items = {}
  for (const audit of audits) {
    const itemClass = audit.get('itemClass')
    if (!(itemClass in items)) {
      items[itemClass] = []
    }
    items[itemClass].push(audit.get('itemId'))
  }
  const fetchedItems = await Promise.all(Object.keys(items).map(async (itemClass) => {
    return $query(itemClass)
      .containedIn('objectId', items[itemClass])
      .include('deleted')
      .find({ useMasterKey: true })
  })).then(itemArrays => itemArrays.flat())

  for (const audit of audits) {
    const item = fetchedItems.find(({ className, id }) => audit.get('itemId') === id && audit.get('itemClass') === className)
    item && audit.set('item', item.toJSON())
  }
  return audits
})

Parse.Cloud.afterLiveQueryEvent(Audit, async ({ object: audit, event }) => {
  if (event === 'create') {
    const { itemClass, itemId } = audit.attributes
    const item = await (new Parse.Query(itemClass)).include('deleted').get(itemId, { useMasterKey: true })
    audit.set('item', item)
  }
})

const audit = function ({ className, id, objectId }, audit) {
  if (!audit) {
    return
  }
  const auditItem = new Audit({
    itemClass: className,
    itemId: id || objectId,
    ...audit
  })
  if (audit.user?.objectId) {
    auditItem.set('user', $parsify(Parse.User, audit.user.objectId).toPointer())
  }
  return auditItem.save(null, { useMasterKey: true })
}

const deleteAudits = async function ({ object } = {}) {
  if (!object) { return }
  const query = $query(Audit)
    .equalTo('itemClass', object.className)
    .equalTo('itemId', object.id)
  let skip = 0
  while (true) {
    const audits = await query.skip(skip).find({ useMasterKey: true })
    if (!audits.length) {
      break
    }
    skip += audits.length
    await Parse.Object.destroyAll(audits, { useMasterKey: true })
  }
  return `${skip} audits deleted`
}
module.exports = {
  audit,
  deleteAudits
}

global.$audit = audit
global.$deleteAudits = deleteAudits
