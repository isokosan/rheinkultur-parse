const { client, INDEXES } = require('@/cloud/search')
const { chunk } = require('lodash')

async function reindexStreets () {
  const index = 'rheinkultur-streets-autocomplete'
  const query = INDEXES[index].parseQuery
  const bodies = await query
    .then(INDEXES[index].datasetMap)
    .then(dataset => dataset.flatMap(({ doc, _id }) => [{ index: { _index: index, _id } }, doc]))
  await client.indices.exists({ index }) && await client.indices.delete({ index })
  await client.indices.create({ index, body: INDEXES[index].config })
  let i = 0
  for (const body of chunk(bodies, 10000)) {
    const { items } = await client.bulk({ refresh: true, body })
    i += items.length
  }
  return i
}

// If you run into resource_exists issues, delete the docker containers etc with "docker system prune"
module.exports = async function (job) {
  const streets = await reindexStreets()
  const index = 'rheinkultur-cities-autocomplete'
  await client.indices.exists({ index }) && await client.indices.delete({ index })
  await client.indices.create({ index, body: INDEXES[index].config })
  const query = INDEXES[index].parseQuery
  query.limit(1000)
  const total = await query.count({ useMasterKey: true })
  let cities = 0
  while (true) {
    query.skip(cities)
    const body = await query.find({ useMasterKey: true })
      .then(INDEXES[index].datasetMap)
      .then(dataset => dataset.flatMap(({ doc, _id }) => [{ index: { _index: index, _id } }, doc]))
    if (!body.length) { break }
    const { items } = await client.bulk({ refresh: true, body })
    cities += items.length
    const progress = parseInt(100 * cities / total)
    job && job.progress(progress)
  }
  return Promise.resolve({
    streets,
    cities
  })
}
