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

global.$states = {
  NI: 'Niedersachsen',
  BW: 'Baden-Württemberg',
  SH: 'Schleswig-Holstein',
  BY: 'Bayern',
  SL: 'Saarland',
  HB: 'Bremen',
  MV: 'Mecklenburg-Vorpommern',
  HE: 'Hessen',
  TH: 'Thüringen',
  RP: 'Rheinland-Pfalz',
  ST: 'Sachsen-Anhalt',
  HH: 'Hamburg',
  NW: 'Nordrhein-Westfalen',
  SN: 'Sachsen',
  BB: 'Brandenburg',
  BE: 'Berlin'
}

module.exports = {
  fetchStates
}
