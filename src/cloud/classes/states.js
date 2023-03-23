const State = Parse.Object.extend('State')

Parse.Cloud.beforeSave(State, async () => {
  throw new Error('States are not allowed to be saved')
})

const fetchStates = async function () {
  const response = {}
  for (const item of await $query(State).find({ useMasterKey: true })) {
    const { name } = item.attributes
    response[item.id] = { name, objectId: item.id }
  }
  return response
}

module.exports = {
  fetchStates
}
