const { difference } = require('lodash')
const { ensureUniqueField } = require('@/utils')

const Tag = Parse.Object.extend('Tag')

Parse.Cloud.beforeSave(Tag, async ({ object: tag }) => {
  await ensureUniqueField(tag, 'name')
})

Parse.Cloud.afterDelete(Tag, async ({ object: tag }) => {
  const companiesQuery = $query('Company')
    .include('deleted')
    .equalTo('tags', tag)
  while (true) {
    const companies = await companiesQuery.find({ useMasterKey: true })
    if (!companies.length) {
      break
    }
    await Parse.Object.saveAll(companies.map((company) => {
      const tags = company.get('tags')
      return company.set('tags', tags.filter(tag => tag))
    }), { useMasterKey: true })
  }
})

Parse.Cloud.define('tag-save', async ({ params: { id: tagId, parentId, name } }) => {
  const tag = tagId
    ? await $query(Tag).get(tagId, { useMasterKey: true })
    : new Tag()
  tag.set({
    name,
    parent: parentId ? $pointer(Tag, parentId) : null
  })
  return tag.save(null, { useMasterKey: true })
}, {
  requireUser: true,
  fields: {
    name: {
      type: String,
      required: true
    }
  }
})

// TODO: Check tag is not used by any taggable
// Parse.Cloud.define('tag-remove', async ({ params: { id: tagId }, user }) => {
//   const tag = await $getOrFail(Tag, tagId)
//   return tag.destroy({ useMasterKey: true })
// })

Parse.Cloud.define('item-tags', async ({ params: { itemId, itemClass, tagIds }, user }) => {
  const item = await (new Parse.Query(itemClass)).get(itemId, { useMasterKey: true })
  const beforeTagIds = (item.get('tags') || []).map(t => t.id)
  const data = {}
  const added = difference(tagIds, beforeTagIds)
  if (added.length) {
    data.added = added
  }
  const removed = difference(beforeTagIds, tagIds)
  if (removed.length) {
    data.removed = removed
  }
  if (!Object.keys(data).length) {
    throw new Error('Keine Änderungen')
  }
  const tags = tagIds.filter(x => x).map(id => $pointer('Tag', id))
  tags.length ? item.set({ tags }) : item.unset('tags')
  const audit = { user, fn: 'update-tags', data }
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

const fetchTags = async () => {
  const tags = await $query(Tag).find({ useMasterKey: true })
  const response = {}
  for (const tag of tags) {
    response[tag.id] = { objectId: tag.id, name: tag.get('name') }
  }
  return response
}

module.exports = {
  fetchTags
}
