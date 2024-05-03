Parse.Cloud.define('offer-fetch', async ({ params: { key } }) => {
  const [className, objectId] = key.split('-')
  const order = await $getOrFail(className, objectId, ['all', 'responsibles'])
  return order.toJSON()
})
