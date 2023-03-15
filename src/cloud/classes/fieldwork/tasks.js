Parse.Cloud.define('tasks-locations', async ({ user }) => {
  const departureLists = await $query('DepartureList').find({ sessionToken: user.get('sessionToken') })
  const locations = {}
  for (const departureList of departureLists) {
    const { ort, state, type, cubeCount, approvedCubeCount } = departureList.attributes
    const location = [ort, state.id].join(':')
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
    locations[location].tasks[type].cubeCount += cubeCount
    locations[location].tasks[type].approvedCubeCount += approvedCubeCount
  }
  return locations
})

Parse.Cloud.define('tasks-location', async ({ params: { locationKey }, user }) => {
  const [ort, stateId] = locationKey.split(':')
  const state = $pointer('State', stateId)
  const departureLists = await $query('DepartureList')
    .equalTo('ort', ort)
    .equalTo('state', state)
    .find({ sessionToken: user.get('sessionToken') })
  const location = { ort, state, tasks: {} }
  for (const departureList of departureLists) {
    const { type, cubeCount, approvedCubeCount } = departureList.attributes
    if (!location.tasks[type]) {
      location.tasks[type] = {
        cubeCount: 0,
        approvedCubeCount: 0
      }
    }
    location.tasks[type].cubeCount += cubeCount
    location.tasks[type].approvedCubeCount += approvedCubeCount
  }
  return location
})
