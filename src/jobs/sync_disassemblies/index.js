module.exports = async function (job) {
  const orderQueries = ['Contract', 'Booking'].map(className => ({
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
  await $query('Disassembly')
    .matchesQuery('contract', $query('Contract').equalTo('disassembly.fromRMV', null)).each(async (record) => {
      const { id } = record.get('contract')
      const messages = await Parse.Cloud.run('disassembly-order-sync', { className: 'Contract', id }, { useMasterKey: true })
      i++
      messages && (actions['Contract-' + id] = messages)
      consola.debug('Contract', record.get('contract').id, messages)
    }, { useMasterKey: true })
  await $query('Disassembly')
    .matchesQuery('booking', $query('Booking').equalTo('disassembly.fromRMV', null)).each(async (record) => {
      const { id } = record.get('booking')
      const messages = await Parse.Cloud.run('disassembly-order-sync', { className: 'Booking', id }, { useMasterKey: true })
      i++
      messages && (actions['Booking-' + id] = messages)
      consola.debug('Booking', record.get('booking').id, messages)
    }, { useMasterKey: true })
  return Promise.resolve({ i, actions })
}
