const { setCubeOrderStatuses } = require('@/shared')

Parse.Cloud.define('manual-updates-set-cube-statuses', ({ params: { orderClass, orderId } }) => {
  return $getOrFail(orderClass, orderId).then(setCubeOrderStatuses)
}, { requireMaster: true })
