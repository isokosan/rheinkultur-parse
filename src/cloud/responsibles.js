const { difference } = require('lodash')

Parse.Cloud.define('item-responsibles', async ({ params: { itemId, itemClass, responsibleIds }, user }) => {
  const item = await (new Parse.Query(itemClass)).get(itemId, { useMasterKey: true })
  const beforeResponsibleIds = (item.get('responsibles') || []).map(r => r.id)
  const data = {}
  const added = difference(responsibleIds, beforeResponsibleIds)
  if (added.length) {
    data.added = added
  }
  const removed = difference(beforeResponsibleIds, responsibleIds)
  if (removed.length) {
    data.removed = removed
  }
  if (!Object.keys(data).length) {
    throw new Error('Keine Änderungen')
  }
  responsibleIds.length
    ? item.set({ responsibles: responsibleIds.map(id => $pointer(Parse.User, id)) })
    : item.unset('responsibles')
  const audit = { user, fn: 'update-responsibles', data }
  await item.save(null, { useMasterKey: true, context: { audit } })
  return data.added ? 'Hinzugefügt.' : 'Entfernt.'
}, {
  requireUser: true,
  fields: {
    itemClass: {
      type: String,
      required: true
    },
    itemId: {
      type: String,
      required: true
    }
  }
})
