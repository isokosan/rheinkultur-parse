const { client, INDEXES, deleteAndRecreateIndex } = require('@/cloud/search')

module.exports = async function (job) {
  const indexes = ['rheinkultur-frame-mount-requests', 'rheinkultur-frame-mount-takedowns']
  const response = {}
  for (const index of indexes) {
    await deleteAndRecreateIndex(index)
    const query = INDEXES[index].parseQuery
    const total = await query.count({ useMasterKey: true })
    let i = 0
    await query.eachBatch(async (results) => {
      const dataset = await INDEXES[index].datasetMap(results)
      const body = dataset.flatMap(({ doc, _id }) => [{ index: { _index: index, _id } }, doc])
      const { items } = await client.bulk({ refresh: true, body })
      const error = items.find(item => item.index.error)
      error && consola.error(error.index.error)
      i += results.length
      const progress = parseInt(100 * i / total)
      job && job.progress(progress)
    }, { useMasterKey: true })
    const { count } = await client.count({ index })
    response[index] = { total, count }
  }
  return Promise.resolve(response)
}
