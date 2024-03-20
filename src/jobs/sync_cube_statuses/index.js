const { ORDER_CLASSES, setOrderCubeStatuses } = require('@/shared')

const classNames = [...ORDER_CLASSES, 'FrameMount']
module.exports = async function (job) {
  const response = { updatedOrders: 0, updatedCubes: 0 }
  for (const className of classNames) {
    response[className] = {}
  }
  let checkedOrders = 0
  let checkedCubes = 0
  const cubeCountAggregate = [
    { $group: { _id: 'id', cubeCount: { $sum: '$cubeCount' } } }
  ]
  // get all orders and set their cube statuses one by one
  const total = await Promise.all(classNames.map(className => $query(className).aggregate(cubeCountAggregate)))
    .then(response => response.reduce((acc, [item]) => acc + item.cubeCount, 0))

  for (const className of classNames) {
    await $query(className).eachBatch(async (orders) => {
      for (const order of orders) {
        checkedOrders += 1
        checkedCubes += order.get('cubeCount')
        const { set, unset } = await setOrderCubeStatuses(order)
        if (set.length || unset.length) {
          consola.info({ no: order.get('no'), set, unset })
          response[className][order.get('no')] = { set, unset }
          response.updatedCubes += (set.length + unset.length)
          response.updatedOrders += 1
        }
        job.progress(parseInt(100 * checkedCubes / total))
      }
    }, { useMasterKey: true })
  }
  response.checkedOrders = checkedOrders
  response.checkedCubes = checkedCubes
  return Promise.resolve(response)
}
