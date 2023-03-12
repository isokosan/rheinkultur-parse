// We should see all disassembly lists under contracts and bookings
// When canceling cubes, or canceling an order - we should have an easy way of generating the lists right away
// This nightly function should also run and generate the lists as they should be.
// This should also remember cases where user wants to remove an abbau, or mark an abbau as abgebaut - this info should persist.

async function upsertDepartureList (attrs) {
  // first check if a departure list with the same
  // uniqueTogether = { type, booking, contract, ort, state, from }
  const exists = await $query('DepartureList')
    .equalTo('type', 'disassembly')
    .equalTo('booking', attrs.booking)
    .equalTo('contract', attrs.contract)
    .equalTo('ort', attrs.ort)
    .equalTo('state', attrs.state)
    .equalTo('from', attrs.from)
    .first({ useMasterKey: true })

  // remove cubeIds from other disassembly lists if it now appears here
  const otherLists = await $query('DepartureList')
    .equalTo('type', 'disassembly')
    .equalTo('booking', attrs.booking)
    .equalTo('contract', attrs.contract)
    .containedIn('cubeIds', attrs.cubeIds)
  exists && otherLists.notEqualTo('objectId', exists.id)

  // TODO: abbau check
  // await otherLists.each(async list => removeCubesFromList(list, cubeIds), { useMasterKey: true })

  if (exists) {
    const cubeChanges = $cubeChanges(exists, attrs.cubeIds)
    if (!cubeChanges) { return exists }
    const audit = { fn: 'departure-list-update', data: { cubeChanges } }
    exists.set('cubeIds', attrs.cubeIds)
    return exists.save(null, { useMasterKey: true, context: { audit } })
  }
  const DepartureList = Parse.Object.extend('DepartureList')
  const departureList = new DepartureList(attrs)
  const audit = { fn: 'departure-list-create' }
  return departureList.save(null, { useMasterKey: true, context: { audit } })
}

module.exports = async function (job) {
  const periodStart = moment().startOf('month').subtract(1, 'month').format('YYYY-MM-DD')
  const periodEnd = moment().endOf('month').add(1, 'month').format('YYYY-MM-DD')
  console.log({ periodStart, periodEnd })

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
  const query = Parse.Query.and(endingQuery, disassemblyQuery)
    .notEqualTo('order', null)
    .greaterThanOrEqualTo('order.endsAt', moment(periodStart).subtract(1, 'day').format('YYYY-MM-DD'))
    .lessThanOrEqualTo('order.endsAt', moment(periodEnd).subtract(1, 'day').format('YYYY-MM-DD'))

  // accumulate all cubes that have to be disassembled within the period, dividing into dates
  const keys = {}
  await query.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const from = moment(cube.get('order').endsAt).add(1, 'day').format('YYYY-MM-DD')
      const uniqueKey = [cube.get('ort'), cube.get('state').id, from].join('_')
      if (!(uniqueKey in keys)) {
        keys[uniqueKey] = { cubeIds: [], booking: cube.get('order').booking, contract: cube.get('order').contract }
      }
      keys[uniqueKey].cubeIds.push(cube.id)
    }
  }, { useMasterKey: true })
  let i = 0
  for (const uniqueKey in keys) {
    const [ort, stateId, from] = uniqueKey.split('_')
    const { cubeIds, booking, contract } = keys[uniqueKey]
    const state = $pointer('State', stateId)
    // TODO: check if exists remove or syncronize
    await upsertDepartureList({
      type: 'disassembly',
      booking,
      contract,
      ort,
      state,
      cubeIds,
      from,
      dueDate: moment(from).add(2, 'weeks').format('YYYY-MM-DD')
    })
    i++
  }
  return Promise.resolve({ disassemblyTasks: i })
}
