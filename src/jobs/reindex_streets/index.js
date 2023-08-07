const { client, INDEXES, deleteAndRecreateIndex } = require('@/cloud/search')
const { chunk } = require('lodash')

// If you run into resource_exists issues, delete the docker containers etc with "docker system prune"
module.exports = async function (job) {
  const index = 'rheinkultur-streets-autocomplete'
  await deleteAndRecreateIndex(index)
  const query = INDEXES[index].parseQuery
  const bodies = await query
    .then(INDEXES[index].datasetMap)
    .then(dataset => dataset.flatMap(({ doc, _id }) => [{ index: { _index: index, _id } }, doc]))
  const total = bodies.length
  await client.indices.exists({ index }) && await client.indices.delete({ index })
  await client.indices.create({ index, body: INDEXES[index].config })
  let indexed = 0
  for (const body of chunk(bodies, 10000)) {
    const { items } = await client.bulk({ refresh: true, body })
    indexed += items.length
    const progress = parseInt(100 * indexed / total)
    job.progress(progress)
  }
  return { indexed }
}
