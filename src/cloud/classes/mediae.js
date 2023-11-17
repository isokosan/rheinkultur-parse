const Media = Parse.Object.extend('Media')

const { ensureUniqueField } = require('@/utils')

Parse.Cloud.beforeSave(Media, async ({ object: media }) => {
  await ensureUniqueField(media, 'no')
})

Parse.Cloud.afterSave(Media, async ({ object: media, context: { audit } }) => {
  audit && $audit(media, audit)
})

const createMediae = function () {
  const Media = Parse.Object.extend('Media')
  return Parse.Object.saveAll([
    {
      no: 'KVZ',
      name: 'KVZ',
      prices: {
        0: 90,
        2: 70
      }
    },
    {
      no: 'MFG',
      name: 'MFG',
      prices: {
        0: 120,
        2: 90
      }
    }
  ].map((item) => new Media(item)), { useMasterKey: true })
}

const fetchMediae = () => $query(Media).find({ useMasterKey: true })

Parse.Cloud.define('media-create', async ({
  params: {
    no,
    name,
    prices
  }, user
}) => {
  const media = new Media({
    no,
    name,
    prices
  })
  const audit = { user, fn: 'media-create' }
  return media.save(null, { useMasterKey: true, context: { audit } })
}, $adminOnly)

Parse.Cloud.define('media-update-prices', async ({
  params: {
    id: mediaId,
    prices
  }, user
}) => {
  const media = await $getOrFail(Media, mediaId)
  media.set({ prices })
  const audit = { user, fn: 'media-update-prices' }
  return media.save(null, { useMasterKey: true, context: { audit } })
}, $adminOnly)

module.exports = {
  createMediae,
  fetchMediae
}
