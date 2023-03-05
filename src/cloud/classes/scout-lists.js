const elastic = require('@/services/elastic')
const { indexScoutTask, unindexScoutTask, indexControlTask, unindexControlTask, indexDisassemblyTask, unindexDisassemblyTask } = require('@/cloud/search')

const ScoutList = Parse.Object.extend('ScoutList')

Parse.Cloud.afterFind(ScoutList, async ({ query, objects: scoutLists }) => {
  if (query._include.includes('locations')) {
    for (const scoutList of scoutLists) {
      const cubeIds = await $query('ScoutTask')
        .distinct('cube', { useMasterKey: true })
        .then(cubes => cubes.map(({ objectId }) => objectId))
      const locations = await $query('Cube').containedIn('objectId', cubeIds).distinct('ort', { useMasterKey: true })
      scoutList.set('locations', locations)
    }
  }
})

Parse.Cloud.define('scout-list-create', async ({
  params: {
    name
  }, user
}) => {
  const scoutList = new ScoutList({ name })

  const audit = { user, fn: 'scout-list-create' }
  return scoutList.save(null, { useMasterKey: true, context: { audit } })
}, {
  requireUser: true,
  fields: {
    name: {
      type: String,
      required: true
    }
  }
})

Parse.Cloud.define('scout-list-update', async ({
  params: {
    id: scoutListId,
    name
  }, user
}) => {
  const scoutList = await $getOrFail(ScoutList, scoutListId)
  scoutList.set({ name })
  return scoutList.save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('scout-list-remove', async ({ params: { id: scoutListId }, user, context: { seedAsId } }) => {
  const scoutList = await $getOrFail(ScoutList, scoutListId)
  if (scoutList.get('status')) {
    throw new Error('Only draft scoutLists can be deleted!')
  }
  return scoutList.destroy({ useMasterKey: true })
}, { requireUser: true })

// add cube ids to digital scouting remscheid
async function getCubeIdsFromSearchQuery (searchQuery) {
  const params = {}
  for (const [key, value] of new URLSearchParams(searchQuery)) {
    params[key] = value
  }
  const cubeIds = []
  const { index, query, sort } = await Parse.Cloud.run('search', {
    ...params,
    s: 'scoutable',
    returnQuery: true
  }, { useMasterKey: true })
  const keepAlive = '1m'
  const size = 5000
  // Sorting should be by _shard_doc or at least include _shard_doc
  sort.push({ _shard_doc: 'desc' })
  let searchAfter
  let pointInTimeId = (await elastic.openPointInTime({ index, keep_alive: keepAlive })).id
  while (true) {
    const { pit_id, hits: { hits } } = await elastic.search({
      body: {
        pit: {
          id: pointInTimeId,
          keep_alive: keepAlive
        },
        size,
        track_total_hits: false,
        query,
        sort,
        search_after: searchAfter
      },
      _source: false
    })
    if (!hits || !hits.length) {
      break
    }
    pointInTimeId = pit_id
    cubeIds.push(...hits.map(({ _id }) => _id))
    if (hits.length < size) {
      break
    }
    // search after has to provide value for each sort
    const lastHit = hits[hits.length - 1]
    searchAfter = lastHit.sort
  }

  return cubeIds
}

// Save cubeids as array to scout list
async function saveCubeIdsToScoutList () {
  const scoutListId = 'wX8hJTtZcb'
  const scoutList = await $getOrFail(ScoutList, scoutListId)
  const searchQuery = scoutList.get('query')
  const cubeIds = await getCubeIdsFromSearchQuery(searchQuery)
  scoutList.set({ cubeIds })
  await scoutList.save(null, { useMasterKey: true })
}
// saveCubeIdsToScoutList().then(consola.info)

// add digital scouting info to cubes
// TAKING TOO LONG TO SAVE TO EACH CUBE (5500 cubes took about 2 minutes)
async function addScoutListInfoToCubes () {
  const scoutListId = 'wX8hJTtZcb'
  const scoutList = await $getOrFail(ScoutList, scoutListId)
  const searchQuery = scoutList.get('query')
  const cubeIds = await getCubeIdsFromSearchQuery(searchQuery)
  return $query('Cube')
    .containedIn('objectId', cubeIds)
    .eachBatch(async (cubes) => {
      for (const cube of cubes) {
        const scout = {
          listId: scoutListId,
          type: 'digital'
        }
        await cube.set({ scout }).save(null, { useMasterKey: true })
      }
      consola.info(cubes.length)
    }, { useMasterKey: true })
}
// addScoutListInfoToCubes().then(consola.info)

async function cleanScoutListInfoInCubes () {
  while (true) {
    const cubes = await $query('Cube').notEqualTo('scout', null).find({ useMasterKey: true })
    if (!cubes.length) { break }
    for (const cube of cubes) {
      await cube.unset('scout').save(null, { useMasterKey: true })
    }
    consola.info(cubes.length)
  }
}
// cleanScoutListInfoInCubes().then(consola.info)

const ScoutTask = Parse.Object.extend('ScoutTask')
Parse.Cloud.beforeFind(ScoutTask, async ({ query }) => {
  query.include(['cube', 'briefing'])
})

Parse.Cloud.beforeSave(ScoutTask, async ({ object: scoutTask }) => {
  await indexScoutTask(scoutTask)
})

Parse.Cloud.beforeDelete(ScoutTask, async ({ object: scoutTask }) => {
  await unindexScoutTask(scoutTask)
})

const ControlTask = Parse.Object.extend('ControlTask')
Parse.Cloud.beforeFind(ControlTask, async ({ query }) => {
  query.include('cube')
})

Parse.Cloud.beforeSave(ControlTask, async ({ object: controlTask }) => {
  await indexControlTask(controlTask)
})

Parse.Cloud.beforeDelete(ControlTask, async ({ object: controlTask }) => {
  await unindexControlTask(controlTask)
})

const DisassemblyTask = Parse.Object.extend('DisassemblyTask')
Parse.Cloud.beforeFind(DisassemblyTask, async ({ query }) => {
  query.include('cube')
})

Parse.Cloud.beforeSave(DisassemblyTask, async ({ object: disassemblyTask }) => {
  await indexDisassemblyTask(disassemblyTask)
})

Parse.Cloud.beforeDelete(DisassemblyTask, async ({ object: disassemblyTask }) => {
  await unindexDisassemblyTask(disassemblyTask)
})

async function generateScoutTasks () {
  const scoutListId = 'wX8hJTtZcb'
  const scoutList = await $getOrFail(ScoutList, scoutListId)
  const searchQuery = scoutList.get('query')
  const cubeIds = await getCubeIdsFromSearchQuery(searchQuery)
  let i = 0
  for (const cubeId of cubeIds) {
    await Parse.Cloud.httpRequest({
      method: 'POST',
      url: `${process.env.PUBLIC_SERVER_URL}/classes/ScoutTask`,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-Master-Key': process.env.MASTER_KEY
      },
      body: {
        objectId: [scoutListId, cubeId].join(':'),
        list: $pointer('ScoutList', scoutListId),
        cube: $pointer('Cube', cubeId)
      }
    }).catch(consola.error)
    i++
    consola.info(i / cubeIds.length * 100 + '%')
  }
  return 'DONE'
  // generate a ScoutTask for each cube, in Entwurf status
}

Parse.Cloud.define('scout-task-update-manager', async ({ params: { id: scoutTaskId, ...params }, user }) => {
  const scoutTask = await $getOrFail(ScoutTask, scoutTaskId)
  const { managerId } = params
  if (managerId === scoutTask.get('manager')?.id) {
    throw new Error('Keine Änderungen')
  }
  const manager = managerId ? $parsify(Parse.User, managerId) : null
  scoutTask.set({ manager })
  await scoutTask.save(null, { useMasterKey: true })
  return {
    data: scoutTask.get('manager'),
    message: 'Manager gespeichert.'
  }
}, { requireUser: true })

Parse.Cloud.define('scout-tasks-update-manager', ({ params: { query, managerId }, user }) => {
  const manager = managerId ? $parsify(Parse.User, managerId) : null
  query = Parse.Query.fromJSON('ScoutTask', query).notEqualTo('manager', manager)
  return query.eachBatch(async (scoutTasks) => {
    for (const scoutTask of scoutTasks) {
      if (managerId === scoutTask.get('manager')?.id) {
        continue
      }
      await scoutTask.set({ manager }).save(null, { useMasterKey: true })
    }
  })
}, { requireUser: true })

async function generateDisassemblyTasks (periodStart, periodEnd, returnCount) {
  const endingQuery = Parse.Query.or(
    $query('Cube').notEqualTo('order.canceledAt', null),
    $query('Cube').notEqualTo('order.earlyCanceledAt', null),
    $query('Cube').equalTo('order.autoExtendsAt', null)
  )
  const contractsQuery = $query('Contract').equalTo('disassembly', true)
  const bookingsQuery = $query('Booking').equalTo('disassembly', true)
  const disassemblyQuery = Parse.Query.or(
    $query('Cube').matchesKeyInQuery('order.contract.objectId', 'objectId', contractsQuery),
    $query('Cube').matchesKeyInQuery('order.booking.objectId', 'objectId', bookingsQuery)
  )
  const query = Parse.Query.and(endingQuery, disassemblyQuery)
    .notEqualTo('order', null)
    .greaterThanOrEqualTo('order.endsAt', moment(periodStart).subtract(1, 'day').format('YYYY-MM-DD'))
    .lessThanOrEqualTo('order.endsAt', moment(periodEnd).subtract(1, 'day').format('YYYY-MM-DD'))

  const count = await query.count({ useMasterKey: true })
  if (returnCount) {
    return count
  }
  let i = 0
  return query.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const objectId = [cube.get('order').no, cube.id].join(':')
      const from = moment(cube.get('order').endsAt).add(1, 'day').format('YYYY-MM-DD')
      const exists = await $query(DisassemblyTask).equalTo('objectId', objectId).first({ useMasterKey: true })
      if (exists && exists.get('from') !== from) {
        exists && await exists.set({ from }).save(null, { useMasterKey: true })
      }
      if (!exists) {
        const body = {
          objectId,
          cube: cube.toPointer(),
          contract: cube.get('order').contract?.toPointer(),
          booking: cube.get('order').booking?.toPointer(),
          from
        }
        await Parse.Cloud.httpRequest({
          method: 'POST',
          url: `${process.env.PUBLIC_SERVER_URL}/classes/DisassemblyTask`,
          headers: {
            'Content-Type': 'application/json;charset=utf-8',
            'X-Parse-Application-Id': process.env.APP_ID,
            'X-Parse-Master-Key': process.env.MASTER_KEY
          },
          body
        })
      }
      i++
      consola.info(i / count * 100 + '%')
    }
  }, { useMasterKey: true })
}

module.exports = {
  saveCubeIdsToScoutList,
  addScoutListInfoToCubes,
  cleanScoutListInfoInCubes,
  generateScoutTasks,
  generateDisassemblyTasks
}
