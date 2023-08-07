const { client, INDEXES, deleteAndRecreateIndex } = require('@/cloud/search')

module.exports = async function (job) {
  const index = 'rheinkultur-bookings'
  await deleteAndRecreateIndex(index)
  const query = INDEXES[index].parseQuery
  query.limit(1000)
  const total = await query.count({ useMasterKey: true })
  let i = 0
  while (true) {
    query.skip(i)
    const body = await query.find({ useMasterKey: true })
      .then(INDEXES[index].datasetMap)
      .then(dataset => dataset.flatMap(({ doc, _id }) => [{ index: { _index: index, _id } }, doc]))
    if (!body.length) {
      break
    }
    const { items } = await client.bulk({ refresh: true, body })
    i += items.length
    const progress = parseInt(100 * i / total)
    job && job.progress(progress)
  }
  const { count } = await client.count({ index })
  return `${count} items saved in ${index}`
}
