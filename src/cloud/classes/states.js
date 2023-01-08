const State = Parse.Object.extend('State')

const { ensureUniqueField } = require('@/utils')

Parse.Cloud.beforeSave(State, async ({ object: state }) => {
  await ensureUniqueField(state, 'name')
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
