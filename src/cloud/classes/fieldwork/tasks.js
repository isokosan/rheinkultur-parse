Parse.Cloud.define('tasks-locations', async ({ user }) => {
  const taskLists = await $query('TaskList').find({ sessionToken: user.get('sessionToken') })
  const locations = {}
  for (const taskList of taskLists) {
    const { ort, state, gp, type, cubeCount, completedCubeCount } = taskList.attributes
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
  const taskLists = await $query('TaskList')
    .equalTo('ort', ort)
    .equalTo('state', state)
    .include(['cubeLocations', 'cubeStatuses'])
    .find({ sessionToken: user.get('sessionToken') })
  const location = { ort, stateId, center: city.get('gp'), tasks: {} }
  for (const taskList of taskLists) {
    const { type, cubeCount, completedCubeCount, cubeIds, cubeLocations, cubeStatuses, scoutAddedCubeIds } = taskList.attributes
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
    location.tasks[type].lists[taskList.id] = {
      objectId: taskList.id,
      quotaStatus: taskList.get('quotaStatus'),
      cubeCount,
      completedCubeCount,
      cubes,
      type
    }
  }
  return location
})
