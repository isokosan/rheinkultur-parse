const { client, INDEXES } = require('@/cloud/search')

// If you run into resource_exists issues, delete the docker containers etc with "docker system prune"
module.exports = async function (job) {
  const index = 'rheinkultur-fieldwork'
  await client.indices.exists({ index }) && await client.indices.delete({ index })
  await client.indices.create({ index, body: INDEXES[index].config })
  const query = INDEXES[index].parseQuery
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
  return `${index} created and filled with ${count} items`
}
