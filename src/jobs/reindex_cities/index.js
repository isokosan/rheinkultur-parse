const { client, INDEXES, deleteAndRecreateIndex } = require('@/cloud/search')

const createCity = async (body) => Parse.Cloud.httpRequest({
  method: 'POST',
  url: `${process.env.PUBLIC_SERVER_URL}/classes/City`,
  headers: {
    'Content-Type': 'application/json;charset=utf-8',
    'X-Parse-Application-Id': process.env.APP_ID,
    'X-Parse-Master-Key': process.env.MASTER_KEY
  },
  body
})

// TOLATER: Cities that are not found in the cubes list should be removed
// If you run into resource_exists issues, delete the docker containers etc with "docker system prune"
module.exports = async function (job) {
  // get unique list of locations from cubes
  const locations = await $query('Cube')
    .notEqualTo('ort', null)
    .notEqualTo('state', null)
    .aggregate([{ $group: { _id: { ort: '$ort', stateP: '$state' } } }])
    .then(response => response.map(({ objectId }) => objectId))
  const locationsCount = Object.keys(locations).length
  let l = 0
  for (const { ort, stateP } of locations) {
    const [, stateId] = stateP.split('$')
    const state = $pointer('State', stateId)
    const placeKey = [stateId, ort].join(':')
    const exists = await $query('City').equalTo('objectId', placeKey).count({ useMasterKey: true })
    if (!exists) {
      await createCity({
        objectId: placeKey,
        ort,
        state
      })
    }
    l++
    job.progress(parseInt(90 * l / locationsCount))
  }

  const index = 'rheinkultur-cities-autocomplete'
  await deleteAndRecreateIndex(index)
  const query = INDEXES[index].parseQuery
  query.limit(1000)
  const citiesCount = await query.count({ useMasterKey: true })
  let i = 0
  while (true) {
    query.skip(i)
    const body = await query.find({ useMasterKey: true })
      .then(INDEXES[index].datasetMap)
      .then(dataset => dataset.flatMap(({ doc, _id }) => [{ index: { _index: index, _id } }, doc]))
    if (!body.length) { break }
    const { items } = await client.bulk({ refresh: true, body })
    i += items.length
    job.progress(parseInt(90 + (10 * i / citiesCount)))
  }
  return Promise.resolve({ indexed: i })
}
