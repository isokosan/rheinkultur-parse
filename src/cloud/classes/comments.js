const Comment = Parse.Object.extend('Comment')

Parse.Cloud.afterFind(Comment, async ({ objects: comments }) => {
  for (const comment of comments) {
    if (comment.get('source')) {
      const [sourceClass, sourceId] = comment.get('source').split(':')
      comment.set('source', await $getOrFail(sourceClass, sourceId))
    }
  }
})

Parse.Cloud.define('comment-create', async ({
  params: {
    itemClass,
    itemId,
    source,
    text
  }, user
}) => {
  const comment = new Comment({
    itemId,
    itemClass,
    text,
    createdBy: user
  })
  if (source) {
    const [sourceClass, sourceId] = source.split(':')
    await $getOrFail(sourceClass, sourceId)
    comment.set('source', source)
  }
  return comment.save(null, { useMasterKey: true })
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
    },
    text: {
      type: String,
      required: true
    }
  }
})

Parse.Cloud.define('comment-remove', async ({ params: { id: commentId }, user, master }) => {
  const comment = await $getOrFail(Comment, commentId)
  if (!master) {
    if (!comment.get('createdBy') || comment.get('createdBy').id !== user.id) {
      throw new Parse.Error(403, 'Unbefugter Zugriff')
    }
  }
  return comment.destroy({ useMasterKey: true })
}, { requireUser: true })
