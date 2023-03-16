Parse.Cloud.define('tasks-locations', async ({ user }) => {
  const departureLists = await $query('DepartureList').find({ sessionToken: user.get('sessionToken') })
  const locations = {}
  for (const departureList of departureLists) {
    const { ort, state, type, cubeCount, approvedCubeCount } = departureList.attributes
    const location = [state.id, ort].join(':')
    if (!locations[location]) {
      locations[location] = {
        ort,
        state,
        tasks: {}
      }
    }
    if (!locations[location].tasks[type]) {
      locations[location].tasks[type] = {
        cubeCount: 0,
        approvedCubeCount: 0
      }
    }
    locations[location].tasks[type].cubeCount += (cubeCount || 0)
    locations[location].tasks[type].approvedCubeCount += (approvedCubeCount || 0)
  }
  return locations
})

Parse.Cloud.define('tasks-location', async ({ params: { placeKey }, user }) => {
  const city = await $getOrFail('City', placeKey)
  const [stateId, ort] = placeKey.split(':')
  const state = $pointer('State', stateId)
  const departureLists = await $query('DepartureList')
    .equalTo('ort', ort)
    .equalTo('state', state)
    .include('cubeLocations')
    .select(['cubeIds', 'cubeLocations', 'type', 'cubeCount', 'quotas', 'approvedCubeCount'])
    .find({ sessionToken: user.get('sessionToken') })
  const location = { ort, stateId, center: city.get('gp'), tasks: {} }
  for (const departureList of departureLists) {
    const { type, approvedCubeCount, cubeLocations } = departureList.attributes
    const cubeCount = type === 'scout' ? departureList.get('totalQuota') : departureList.get('cubeCount')

    if (!location.tasks[type]) {
      location.tasks[type] = {
        cubeCount: 0,
        approvedCubeCount: 0,
        lists: {}
      }
    }

    location.tasks[type].cubeCount += (cubeCount || 0)
    location.tasks[type].approvedCubeCount += (approvedCubeCount || 0)
    location.tasks[type].lists[departureList.id] = {
      objectId: departureList.id,
      quotas: departureList.get('quotas'),
      cubeCount,
      approvedCubeCount,
      cubeLocations
    }
  }
  return location
})
