const { client, INDEXES } = require('@/cloud/search')

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

// TOLATER: Cities that are not found in the cubes list are not removed
// If you run into resource_exists issues, delete the docker containers etc with "docker system prune"
module.exports = async function (job) {
  // get unique list of locations from cubes
  const locations = {}
  const cubesCount = await $query('Cube').count({ useMasterKey: true })
  let c = 0
  await $query('Cube')
    .select(['ort', 'state', 'gp'])
    .eachBatch((cubes) => {
      for (const cube of cubes) {
        const { ort, state, gp } = cube.attributes
        const placeKey = [ort, state.id].join(':')
        locations[placeKey] = gp
      }
      c += cubes.length
      job.progress(parseInt(35 * c / cubesCount))
    }, { useMasterKey: true, batchSize: 50000 })

  const locationsCount = Object.keys(locations).length
  let l = 0
  for (const placeKey of Object.keys(locations)) {
    const [ort, stateId] = placeKey.split(':')
    if (ort.trim() !== ort) {
      throw new Error(`Found ort with trim bug: ${ort} ${stateId}`)
    }
    const state = $pointer('State', stateId)
    const gp = locations[placeKey]
    const exists = await $query('City').equalTo('objectId', placeKey).exists({ useMasterKey: true })
    !exists && await createCity({
      objectId: placeKey,
      ort,
      state,
      gp
    }).catch(() => {})
    l++
    job.progress(parseInt(35 + (35 * l / locationsCount)))
  }

  const index = 'rheinkultur-cities-autocomplete'
  await client.indices.exists({ index }) && await client.indices.delete({ index })
  await client.indices.create({ index, body: INDEXES[index].config })
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
    const progress = parseInt(75 + (25 * i / citiesCount))
    job.progress(progress)
  }
  return Promise.resolve({
    // checkedCubes: c,
    // found: l,
    indexed: i
  })
}
