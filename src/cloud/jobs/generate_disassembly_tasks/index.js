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
  const DepartureList = Parse.Object.extend('DepartureList')
  let i = 0
  for (const key in keys) {
    const [ort, stateId, from] = key.split('_')
    const { cubeIds, booking, contract } = keys[key]
    const state = $pointer('State', stateId)
    // TODO: check if exists remove or syncronize
    const departureList = new DepartureList({
      type: 'disassembly',
      booking,
      contract,
      ort,
      state,
      cubeIds,
      from,
      dueDate: moment(from).add(2, 'weeks').format('YYYY-MM-DD')
    })
    await departureList.save(null, { useMasterKey: true })
    i++
  }
  return Promise.resolve({ disassemblyTasks: i })
}
