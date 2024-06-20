// LOCATIONS INDEX ON SCOUT APP
Parse.Cloud.define('tasks-locations', async ({ user }) => {
  const locations = {}
  await $query('TaskList')
    .equalTo('scouts', user)
    .containedIn('status', [2, 3])
    .lessThanOrEqualTo('date', await $today())
    .eachBatch((taskLists) => {
      for (const taskList of taskLists) {
        const { pk: placeKey, priority, ort, state, gp, type, counts } = taskList.attributes
        if (!locations[placeKey]) {
          locations[placeKey] = {
            placeKey,
            ort,
            state,
            gp,
            tasks: {}
          }
        }
        if (!locations[placeKey].tasks[type]) {
          locations[placeKey].tasks[type] = {
            priority,
            completed: 0,
            total: 0
          }
        }
        locations[placeKey].tasks[type].total += (counts.total || 0)
        locations[placeKey].tasks[type].completed += (counts.completed || 0)
      }
    }, { sessionToken: user.get('sessionToken') })
  return Object.values(locations)
})

Parse.Cloud.define('tasks-upcoming-locations', async ({ user }) => $query('TaskList')
  .equalTo('scouts', user)
  .containedIn('status', [2, 3])
  .greaterThan('date', await $today())
  .lessThan('date', moment(await $today()).add(1, 'week').format('YYYY-MM-DD'))
  .ascending('date')
  .find({ sessionToken: user.get('sessionToken') })
  .then((taskLists) => taskLists.map((taskList) => {
    const { pk: placeKey, gp, ort, state, date, type, counts } = taskList.attributes
    return {
      placeKey,
      date,
      gp,
      ort,
      state,
      type,
      counts
    }
  }))
  .then((locations) => locations.reduce((acc, location) => {
    const { date } = location
    delete location.date
    if (!acc[date]) {
      acc[date] = []
    }
    acc[date].push(location)
    return acc
  }, {})))

// LOCATION VIEW ON SCOUT APP
Parse.Cloud.define('tasks-location', async ({ params: { placeKey }, user }) => {
  const city = await $getOrFail('City', placeKey)
  const [stateId, ort] = placeKey.split(':')
  const location = { ort, stateId, center: city.get('gp'), tasks: {} }
  const state = $pointer('State', stateId)
  const taskLists = await $query('TaskList')
    .equalTo('ort', ort)
    .equalTo('state', state)
    .equalTo('scouts', user)
    .containedIn('status', [2, 3])
    .lessThanOrEqualTo('date', await $today())
    .find({ sessionToken: user.get('sessionToken') })

  const STATUS_MAP = {
    undefined: 0, // added to list as is
    approvable: 0, // added to list, admin-approvable
    pending: 1, // form submitted, pending-approval
    approved: 1, // form-approved or approvable-approved
    rejected: 2, // form-rejected
    not_found: 3 // cube not found
  }

  for (const taskList of taskLists) {
    const { type, cubeIds, scoutAddedCubeIds, counts, statuses, gp: center } = taskList.attributes
    let disassemblyType
    if (taskList.get('disassembly')) {
      disassemblyType = taskList.get('disassembly').id.split('-')[0]
    }
    const cubeLocations = await $query('Cube')
      .containedIn('objectId', cubeIds)
      .select('gp')
      .equalTo('dAt', null)
      .limit(cubeIds.length)
      .find({ useMasterKey: true })
      .then((cubes) => cubes.reduce((acc, cube) => {
        acc[cube.id] = cube.get('gp')
        return acc
      }, {}))
    const cubes = cubeIds.reduce((cubes, cubeId) => {
      if (cubeId in cubeLocations) {
        cubes[cubeId] = { s: STATUS_MAP[statuses[cubeId || 'undefined']], gp: cubeLocations[cubeId] }
        if (scoutAddedCubeIds?.includes(cubeId)) {
          cubes[cubeId].scoutAdded = true // this will show the cube as gray on the map
        }
      }
      return cubes
    }, {})

    if (!location.tasks[type]) {
      location.tasks[type] = {
        total: 0,
        completed: 0,
        lists: {}
      }
    }
    location.tasks[type].total += (counts.total || 0)
    location.tasks[type].completed += (counts.completed || 0)
    location.tasks[type].lists[taskList.id] = {
      objectId: taskList.id,
      quotaStatus: taskList.get('quotaStatus'),
      ...counts,
      cubes,
      type,
      disassemblyType,
      center
    }
  }

  return location
})
