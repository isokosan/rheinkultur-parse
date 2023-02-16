const { geMonthYearStartEnd } = require('@/shared')
const Disassembly = Parse.Object.extend('Disassembly')
const DepartureList = Parse.Object.extend('DepartureList')

function getCubesQuery (periodStart, periodEnd) {
  const endingQuery = Parse.Query.or(
    $query('Cube').notEqualTo('order.canceledAt', null),
    $query('Cube').notEqualTo('order.earlyCanceledAt', null),
    $query('Cube').equalTo('order.autoExtendsAt', null)
  )
  const contractsQuery = $query('Contract').equalTo('disassembly', true)
  const bookingsQuery = $query('Booking').equalTo('disassembly', true)
  const disassemblyQuery = Parse.Query.or(
    $query('Cube').matchesKeyInQuery('order.contract.objectId', 'objectId', contractsQuery),
    $query('Cube').matchesKeyInQuery('order.booking.objectId', 'objectId', bookingsQuery)
  )
  return Parse.Query.and(endingQuery, disassemblyQuery)
    .notEqualTo('order', null)
    .greaterThanOrEqualTo('order.endsAt', moment(periodStart).subtract(1, 'day').format('YYYY-MM-DD'))
    .lessThanOrEqualTo('order.endsAt', moment(periodEnd).subtract(1, 'day').format('YYYY-MM-DD'))
    .ascending('order.endsAt')
    .addAscending('objectId')
    .addAscending('ort')
    .addAscending('str')
    .addAscending('hsnr')
}

Parse.Cloud.afterSave(Disassembly, ({ object: disassembly, context: { audit } }) => { $audit(disassembly, audit) })

Parse.Cloud.beforeFind(Disassembly, ({ query }) => {
  query._include.includes('all') && query.include(['departureLists', 'docs'])
})

Parse.Cloud.afterFind(Disassembly, async ({ query, objects: disassemblies }) => {
  for (const disassembly of disassemblies) {
    const { start: periodStart, end: periodEnd } = geMonthYearStartEnd(disassembly.get('name'))
    disassembly.set({ periodStart, periodEnd })
    disassembly.set('cubesQuery', getCubesQuery(periodStart, periodEnd).toJSON())
  }
  if (query._include.includes('departureLists')) {
    const departureLists = await $query(DepartureList).containedIn('disassembly', disassemblies).limit(1000).find({ useMasterKey: true })
    for (const disassembly of disassemblies) {
      disassembly.set('departureLists', departureLists.filter(s => s.get('disassembly').id === disassembly.id))
    }
  }
  if (query._include.includes('departureListCount')) {
    for (const disassembly of disassemblies) {
      disassembly.set('departureListCount', await $query(DepartureList).equalTo('disassembly', disassembly).count({ useMasterKey: true }))
    }
  }
})

Parse.Cloud.afterDelete(Disassembly, $deleteAudits)

Parse.Cloud.define('disassembly-generate-lists', async ({ params: { id: disassemblyId }, user }) => {
  const disassembly = await $getOrFail(Disassembly, disassemblyId)
  const cubesQuery = Parse.Query.fromJSON('Cube', disassembly.get('cubesQuery'))
  const stateCubeIds = {}

  let skip = 0
  while (true) {
    const cubes = await cubesQuery.select('state').skip(skip).find({ useMasterKey: true })
    if (!cubes.length) { break }
    for (const cube of cubes) {
      const stateId = cube.get('state')?.id
      if (!stateCubeIds[stateId]) {
        stateCubeIds[stateId] = []
      }
      stateCubeIds[stateId].push(cube.id)
    }
    skip += cubes.length
  }
  for (const stateId of Object.keys(stateCubeIds)) {
    const state = await $getOrFail('State', stateId)
    let departureList = await $query('DepartureList')
      .equalTo('disassembly', disassembly)
      .equalTo('state', state)
      .first({ useMasterKey: true })
    if (!departureList) {
      const name = `${disassembly.get('name')} (${state.get('name')})`
      departureList = new DepartureList({
        name,
        type: 'disassembly',
        disassembly,
        state,
        cubeIds: stateCubeIds[stateId]
      })
      const audit = { user, fn: 'departure-list-generate' }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
      continue
    }
    const cubeIds = [...new Set([...(departureList.get('cubeIds') || []), ...stateCubeIds[stateId]])]
    const cubeChanges = $cubeChanges(departureList, cubeIds)
    if (cubeChanges) {
      departureList.set({ cubeIds })
      const audit = { user, fn: 'departure-list-update', data: { cubeChanges } }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  return true
}, { requireUser: true })

// Update booking or contract disassembly from RMV
Parse.Cloud.define('disassembly-order-update', async ({
  params: {
    className,
    id,
    disassembly
  }, user
}) => {
  const bc = await $query(className).get(id, { useMasterKey: true })
  const changes = $changes(bc, { disassembly })
  bc.set({ disassembly })
  const audit = { user, fn: className.toLowerCase() + '-update', data: { changes } }
  return bc.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })
