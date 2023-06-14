// LOCATIONS INDEX ON SCOUT APP
Parse.Cloud.define('tasks-locations', async ({ user }) => {
  const taskLists = await $query('TaskList')
    .equalTo('scouts', user)
    .containedIn('status', [2, 3])
    .find({ sessionToken: user.get('sessionToken') })
  const locations = {}
  for (const taskList of taskLists) {
    const { ort, state, gp, type, counts } = taskList.attributes
    const placeKey = [state.id, ort].join(':')
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
        completed: 0,
        total: 0
      }
    }
    locations[placeKey].tasks[type].total += (counts.total || 0)
    locations[placeKey].tasks[type].completed += (counts.completed || 0)
  }
  return Object.values(locations)
})

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
    .find({ sessionToken: user.get('sessionToken') })

  const STATUS_MAP = {
    undefined: 0,
    pending: 1,
    approved: 1,
    rejected: 2
  }

  for (const taskList of taskLists) {
    const { type, cubeIds, scoutAddedCubeIds, counts, statuses } = taskList.attributes
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
      type
    }
  }

  return location
})
