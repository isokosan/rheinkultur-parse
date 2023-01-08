const { client, INDEXES } = require('@/cloud/search')
const { chunk } = require('lodash')

// If you run into resource_exists issues, delete the docker containers etc with "docker system prune"
module.exports = async function (job) {
  const response = {}
  for (const index of ['rheinkultur-streets-autocomplete', 'rheinkultur-cities-autocomplete']) {
    const bodies = await INDEXES[index].parseQuery
      .then(INDEXES[index].datasetMap)
      .then(dataset => dataset.flatMap(({ doc, _id }) => [{ index: { _index: index, _id } }, doc]))
    await client.indices.exists({ index }) && await client.indices.delete({ index })
    await client.indices.create({ index, body: INDEXES[index].config })
    response[index] = 0
    for (const body of chunk(bodies, 10000)) {
      const { items } = await client.bulk({ refresh: true, body })
      response[index] += items.length
    }
  }
  return Promise.resolve(response)
}
