const { difference, isEqual } = require('lodash')

const Audit = Parse.Object.extend('Audit')

Parse.Cloud.beforeFind(Audit, ({ query, user }) => {
  const company = user?.get('company')
  if (company) {
    let constraintQuery = $query('Audit').matchesQuery('user', $query(Parse.User).equalTo('company', company))
    // if user is booking manager, get bookings related audits
    if (user?.get('accType') === 'partner' && user?.get('permissions').includes('manage-bookings')) {
      const bookingsQuery = $query('Audit')
        .equalTo('itemClass', 'Booking')
        .matchesKeyInQuery('itemId', 'objectId', $query('Booking').equalTo('company', company))
      constraintQuery = Parse.Query.or(constraintQuery, bookingsQuery)
    }
    return Parse.Query.and(query, constraintQuery)
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

function normalizeAuditValue (value) {
  if (value === undefined || value === null) {
    return null
  }
  if (value?.toJSON) {
    value = value.toJSON()
  }
  if (value?.thumb && value.name) {
    return {
      name: value.name,
      url: value.thumb._url || value.thumb.url
    }
  }
  return value
}

const changes = function (item, fields, rawObject = false) {
  const response = {}
  for (const key of Object.keys(fields)) {
    const oldValue = normalizeAuditValue(rawObject ? item[key] : item.get(key))
    const newValue = normalizeAuditValue(fields[key])
    if (!isEqual(oldValue, newValue)) {
      if (key !== 'form') {
        response[key] = [oldValue, newValue]
        continue
      }
      // this is for nested forms in objects (scout submissions)
      // when using the form the keys within the form should not exits in the fields
      for (const formKey of Object.keys(newValue)) {
        const oldFormValue = oldValue.form[formKey]
        const newFormValue = newValue.form[formKey]
        if (!isEqual(oldFormValue, newFormValue)) {
          response[formKey] = [oldFormValue, newFormValue]
        }
      }
    }
  }
  return response
}
const cubeChanges = function (item, cubeIds) {
  let changed = false
  const cubeChanges = {}
  const added = difference(cubeIds, item.get('cubeIds'))
  if (added.length) {
    changed = true
    cubeChanges.added = added
  }
  const removed = difference(item.get('cubeIds'), cubeIds)
  if (removed.length) {
    changed = true
    cubeChanges.removed = removed
  }
  return changed ? cubeChanges : null
}

module.exports = {
  audit,
  deleteAudits,
  changes,
  cubeChanges
}

global.$audit = audit
global.$deleteAudits = deleteAudits
global.$changes = changes
global.$cubeChanges = cubeChanges
