const { lowerFirst } = require('lodash')
const { ORDER_CLASSES } = require('@/shared')

module.exports = async function (job) {
  const orderQueries = ORDER_CLASSES.map(className => ({
    className,
    query: $query(className).equalTo('disassembly.fromRMV', true)
  }))
  const total = await Promise.all(orderQueries.map(({ query }) => query.count({ useMasterKey: true }))).then(counts => counts.reduce((a, b) => a + b, 0))
  let i = 0
  const actions = {}
  for (const { className, query } of orderQueries) {
    await query.select('id').eachBatch(async (records) => {
      for (const { id } of records) {
        const messages = await Parse.Cloud.run('disassembly-order-sync', { className, id }, { useMasterKey: true })
        i++
        messages && (actions[className + '-' + id] = messages)
        consola.debug(className, id, messages)
        job.progress(parseInt(i / total * 100))
      }
    }, { useMasterKey: true })
  }

  // Run sync on removed disassemblies
  for (const className of ORDER_CLASSES) {
    const fieldName = lowerFirst(className)
    await $query('Disassembly')
      .matchesQuery(fieldName, $query(className).equalTo('disassembly.fromRMV', null)).each(async (record) => {
        const { id } = record.get(lowerFirst)
        const messages = await Parse.Cloud.run('disassembly-order-sync', { className, id }, { useMasterKey: true })
        i++
        messages && (actions[[className, id].join('-')] = messages)
        consola.debug(className, id, messages)
      }, { useMasterKey: true })
  }
  return Promise.resolve({ i, actions })
}
