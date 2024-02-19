// ([^\d]*\s*[^\d]+) .* ([^\d]*\s*[^\d]+) \d (.*)\n
// { ort: '$1', state: '$2', planned: $3 },\n
const { fetchStates } = require('./states')
const LOCATION_LIST = [
  { ort: 'Karlsruhe', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Heilbronn', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Mannheim ', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Freiburg im Breisgau ', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Baden-Baden', state: 'Baden-Württemberg', planned: 100 },
  { ort: 'Böblingen', state: 'Baden-Württemberg', planned: null },
  { ort: 'Esslingen am Neckar', state: 'Baden-Württemberg', planned: null },
  { ort: 'Heidelberg ', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Leonberg ', state: 'Baden-Württemberg', planned: null },
  { ort: 'Ludwigsburg', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Pforzheim', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Reutlingen ', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Sindelfingen ', state: 'Baden-Württemberg', planned: null },
  { ort: 'Tübingen ', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Ulm', state: 'Baden-Württemberg', planned: null },
  // { ort: 'Bodensee-Netz', state: 'Baden-Württemberg', planned: null },
  { ort: 'Stuttgart', state: 'Baden-Württemberg', planned: 250 },
  { ort: 'Augsburg ', state: 'Bayern ', planned: 100 },
  { ort: 'Bayreuth ', state: 'Bayern ', planned: null },
  { ort: 'Ingolstadt ', state: 'Bayern ', planned: 50 },
  { ort: 'Passau ', state: 'Bayern ', planned: null },
  { ort: 'Marburg', state: 'Hessen ', planned: null },
  { ort: 'Wiesbaden', state: 'Hessen ', planned: 150 },
  { ort: 'Braunschweig ', state: 'Niedersachsen', planned: 200 },
  { ort: 'Oldenburg (Oldenburg)', state: 'Niedersachsen', planned: 50 },
  { ort: 'Dortmund ', state: 'Nordrhein-Westfalen', planned: 250 },
  { ort: 'Düsseldorf ', state: 'Nordrhein-Westfalen', planned: 300 },
  { ort: 'Mülheim an der Ruhr', state: 'Nordrhein-Westfalen', planned: 100 },
  { ort: 'Bonn ', state: 'Nordrhein-Westfalen', planned: 200 },
  { ort: 'Bottrop', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Gütersloh', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Recklinghausen ', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Münster', state: 'Nordrhein-Westfalen', planned: 250 },
  { ort: 'Bielefeld', state: 'Nordrhein-Westfalen', planned: 150 },
  { ort: 'Hamm ', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Paderborn', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Ludwigshafen am Rhein', state: 'Rheinland-Pfalz', planned: 50 },
  { ort: 'Kaiserslautern ', state: 'Rheinland-Pfalz', planned: null },
  { ort: 'Koblenz', state: 'Rheinland-Pfalz', planned: 100 },
  { ort: 'Trier', state: 'Rheinland-Pfalz', planned: 100 },
  { ort: 'Chemnitz ', state: 'Sachsen', planned: 150 },
  { ort: 'Dresden', state: 'Sachsen', planned: 200 },
  { ort: 'Leipzig', state: 'Sachsen', planned: 250 },
  { ort: 'Halle (Saale)', state: 'Sachsen-Anhalt ', planned: 100 },
  { ort: 'Magdeburg', state: 'Sachsen-Anhalt ', planned: 150 },
  { ort: 'Flensburg', state: 'Schleswig-Holstein ', planned: null },
  { ort: 'Lüneburg ', state: 'Niedersachsen', planned: null }
].map((city) => {
  city.ort = city.ort.trim()
  city.state = city.state.trim()
  return city
})

const { countCubes } = require('@/cloud/search')
// Force company
const companyId = '19me3Ge8LZ'

Parse.Cloud.define('frames-locations', async ({ params: { force }, user }) => {
  const isFramesManager = user.get('permissions').includes('manage-frames')
  if (!isFramesManager) {
    throw new Parse.Error(401, 'Unauthorized')
  }
  const cacheKey = companyId ? 'frames-' + companyId : 'locations'
  return $cache(cacheKey, {
    async cacheFn () {
      const states = await fetchStates()
      const locations = LOCATION_LIST.map((location) => {
        location.stateId = Object.values(states).find((state) => state.name === location.state)?.objectId
        if (!location.stateId) { throw new Error(location.state) }
        location.placeKey = [location.stateId, location.ort].join(':')
        return location
      })
      const wawiCities = await $query('City').containedIn('objectId', locations.map(l => l.placeKey)).select('population').find({ useMasterKey: true })
      const scoutLists = await $query('TaskList')
        .equalTo('type', 'scout')
        .matchesQuery('briefing', $query('Briefing').equalTo('company', $parsify('Company', companyId)))
        .containedIn('pk', locations.map(l => l.placeKey))
        .limit(locations.length * 2)
        .find({ useMasterKey: true })

      return {
        locations: await Promise.all(locations.map(async (location) => {
          location.wawiCity = wawiCities.find((c) => c.id === location.placeKey)
          location.population = location.wawiCity?.get('population')
          location.taskLists = scoutLists.filter((list) => list.get('pk') === location.placeKey)
          // get counts
          location.counts = location.taskLists.reduce((acc, list) => {
            const counts = list.get('counts') || {}
            for (const key of Object.keys(counts)) {
              acc[key] = (acc[key] || 0) + counts[key]
            }
            return acc
          }, {})
          if (!location.counts.total && location.wawiCity) {
            location.counts.total = await countCubes({
              filter: [
                { term: { 'ort.keyword': location.ort } },
                { term: { 'state.objectId.keyword': location.stateId } }
              ],
              must: [
                { range: { s: { lt: 5 } } }
              ]
            })
          }
          if (location.counts.total) {
            location.cubes = location.counts.total
            location.progress = parseInt((location.counts.completed / location.counts.total) * 100)
          }
          return location
        }))
      }
    },
    maxAge: [5, 'minutes'],
    force
  })
}, { requireUser: true })

// TEMPORARY FUNCTION
Parse.Cloud.define('frames-rejections', async ({ params: { taskListIds }, user }) => {
  const isFramesManager = user.get('permissions').includes('manage-frames')
  if (!isFramesManager) {
    throw new Parse.Error(401, 'Unauthorized')
  }
  const taskListsQuery = await $query('TaskList').containedIn('objectId', taskListIds)
  return $query('ScoutSubmission')
    .matchesQuery('taskList', taskListsQuery)
    .equalTo('status', 'rejected')
    .include(['cube', 'photos'])
    .limit(1000)
    .find({ useMasterKey: true })
}, { requireUser: true })

// function calculateRemainingTakedownQuota() {
//   const allowedTakedownRate = 0.1
//   const items = [
//     { type: 'mount', count: 200 },
//     { type: 'takedown', count: 20 },
//     { type: 'mount', count: 50 },
//     { type: 'unmount', count: 15 },
//     { type: 'takedown', count: 1 },
//     { type: 'mount', count: 100 }
//   ]
//   // should be 30 * 10% = 3 takedowns remaining
//   const mounts = items.filter((m) => m.type === 'mount').reduce((acc, { count }) => acc + count, 0)
//   const unmounts = items.filter((m) => m.type === 'unmount').reduce((acc, { count }) => acc + count, 0)
//   const takedowns = items.filter((m) => m.type === 'takedown').reduce((acc, { count }) => acc + count, 0)
//   const active = mounts - (unmounts + takedowns)
//   const remainingTakedownQuota = Math.floor(active * allowedTakedownRate) - takedowns
//   console.log({ mounts, unmounts, takedowns, active, remainingTakedownQuota })
//   return remainingTakedownQuota
// }
// calculateRemainingTakedownQuota()
