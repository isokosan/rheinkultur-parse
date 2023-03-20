Parse.Cloud.define('tasks-locations', async ({ user }) => {
  const departureLists = await $query('DepartureList').find({ sessionToken: user.get('sessionToken') })
  const locations = {}
  for (const departureList of departureLists) {
    const { ort, state, gp, type, cubeCount, completedCubeCount } = departureList.attributes
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
        cubeCount: 0,
        completedCubeCount: 0
      }
    }
    locations[placeKey].tasks[type].cubeCount += (cubeCount || 0)
    locations[placeKey].tasks[type].completedCubeCount += (completedCubeCount || 0)
  }
  return Object.values(locations)
})

Parse.Cloud.define('tasks-location', async ({ params: { placeKey }, user }) => {
  const city = await $getOrFail('City', placeKey)
  const [stateId, ort] = placeKey.split(':')
  const state = $pointer('State', stateId)
  const departureLists = await $query('DepartureList')
    .equalTo('ort', ort)
    .equalTo('state', state)
    .include(['cubeLocations', 'cubeStatuses'])
    .find({ sessionToken: user.get('sessionToken') })
  const location = { ort, stateId, center: city.get('gp'), tasks: {} }
  for (const departureList of departureLists) {
    const { type, cubeCount, completedCubeCount, cubeIds, cubeLocations, cubeStatuses, scoutAddedCubeIds } = departureList.attributes
    const cubes = cubeIds.reduce((cubes, cubeId) => {
      if (cubeId in cubeStatuses && cubeId in cubeLocations) {
        cubes[cubeId] = { s: cubeStatuses[cubeId], gp: cubeLocations[cubeId] }
        if (scoutAddedCubeIds?.includes(cubeId)) {
          cubes[cubeId].scoutAdded = true // this will show the cube as gray on the map
        }
      }
      return cubes
    }, {})
    if (!location.tasks[type]) {
      location.tasks[type] = {
        cubeCount: 0,
        completedCubeCount: 0,
        lists: {}
      }
    }
    location.tasks[type].cubeCount += (cubeCount || 0)
    location.tasks[type].completedCubeCount += (completedCubeCount || 0)
    location.tasks[type].lists[departureList.id] = {
      objectId: departureList.id,
      quotaStatus: departureList.get('quotaStatus'),
      cubeCount,
      completedCubeCount,
      cubes,
      type
    }
  }
  return location
})
