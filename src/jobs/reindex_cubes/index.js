const { client, INDEXES, createOrUpdateIndex } = require('@/cloud/search')

module.exports = async function (job) {
  job.log('Syncing blacklisted plzs and cubes')
  await $query('PLZ').each(plz => plz.save(null, { useMasterKey: true, context: { skipSyncCubes: true } }), { useMasterKey: true })
  job.log('Synced blacklisted plzs')
  const index = 'rheinkultur-cubes'
  await createOrUpdateIndex(index)
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
