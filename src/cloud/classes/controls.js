const Control = Parse.Object.extend('Control')
const DepartureList = Parse.Object.extend('DepartureList')

function getCubesQuery (control) {
  const { date, lastControlBefore, criteria } = control.attributes
  // order status is active, canceled or ended
  let cubesQuery = $query('Cube')
    .greaterThan('order.status', 2)
    // .lessThan('order.startsAt', date) // TODO: add later
    .greaterThan('order.endsAt', date)
  if (lastControlBefore) {
    const lastControlAt = moment(date).subtract(lastControlBefore, 'months').toDate()
    const lastControlQuery = Parse.Query.or(
      $query('Cube').doesNotExist('cAt'),
      $query('Cube').lessThan('cAt', lastControlAt)
    )
    cubesQuery = Parse.Query.and(cubesQuery, lastControlQuery)
  }

  const filters = {
    ort: { include: [], exclude: [] },
    Tag: { include: [], exclude: [] },
    Company: { include: [], exclude: [] },
    Contract: { include: [], exclude: [] },
    Booking: { include: [], exclude: [] }
  }
  for (const criterion of criteria) {
    filters[criterion.type][criterion.op].push(criterion.value)
  }

  filters.ort.include.length && cubesQuery.containedIn('ort', filters.ort.include)
  filters.ort.exclude.length && cubesQuery.notContainedIn('ort', filters.ort.exclude)
  if (filters.Tag.include.length) {
    const tagsQuery = $query('Tag')
    filters.Tag.include.length && tagsQuery.containedIn('objectId', filters.Tag.include)
    const contractsQuery = $query('Contract').matchesQuery('tags', tagsQuery)
    const bookingsQuery = $query('Booking').matchesQuery('tags', tagsQuery)
    cubesQuery = Parse.Query.and(
      cubesQuery,
      Parse.Query.or(
        $query('Cube').matchesKeyInQuery('order.contract.objectId', 'objectId', contractsQuery),
        $query('Cube').matchesKeyInQuery('order.booking.objectId', 'objectId', bookingsQuery)
      )
    )
  }
  if (filters.Tag.exclude.length) {
    const tagsQuery = $query('Tag')
    filters.Tag.exclude.length && tagsQuery.containedIn('objectId', filters.Tag.exclude)
    const contractsQuery = $query('Contract').doesNotMatchQuery('tags', tagsQuery)
    const bookingsQuery = $query('Booking').doesNotMatchQuery('tags', tagsQuery)
    cubesQuery = Parse.Query.and(
      cubesQuery,
      Parse.Query.or(
        $query('Cube').matchesKeyInQuery('order.contract.objectId', 'objectId', contractsQuery),
        $query('Cube').matchesKeyInQuery('order.booking.objectId', 'objectId', bookingsQuery)
      )
    )
  }
  if (filters.Company.include.length) {
    const companiesQuery = $query('Company').containedIn('objectId', filters.Company.include)
    cubesQuery.matchesKeyInQuery('order.company.objectId', 'objectId', companiesQuery)
  }
  if (filters.Company.exclude.length) {
    const companiesQuery = $query('Company').containedIn('objectId', filters.Company.exclude)
    cubesQuery.doesNotMatchKeyInQuery('order.company.objectId', 'objectId', companiesQuery)
  }
  const contractsQuery = $query('Cube')
  let contracts = false
  if (filters.Contract.include.length) {
    const query = $query('Contract').containedIn('objectId', filters.Contract.include)
    contractsQuery.matchesKeyInQuery('order.contract.objectId', 'objectId', query)
    contracts = true
  }
  if (filters.Contract.exclude.length) {
    const query = $query('Contract').containedIn('objectId', filters.Contract.exclude)
    contractsQuery.doesNotMatchKeyInQuery('order.contract.objectId', 'objectId', query)
    contracts = true
  }
  const bookingsQuery = $query('Cube')
  let bookings = false
  if (filters.Booking.include.length) {
    const query = $query('Booking').containedIn('objectId', filters.Booking.include)
    bookingsQuery.matchesKeyInQuery('order.booking.objectId', 'objectId', query)
    bookings = true
  }
  if (filters.Booking.exclude.length) {
    const query = $query('Booking').containedIn('objectId', filters.Booking.exclude)
    bookingsQuery.doesNotMatchKeyInQuery('order.booking.objectId', 'objectId', query)
    bookings = true
  }
  const ordersQuery = contracts && bookings ? Parse.Query.or(contractsQuery, bookingsQuery) : contracts ? contractsQuery : bookings ? bookingsQuery : null
  cubesQuery = ordersQuery ? Parse.Query.and(cubesQuery, ordersQuery) : cubesQuery
  return cubesQuery
}

Parse.Cloud.afterSave(Control, ({ object: control, context: { audit } }) => { $audit(control, audit) })

Parse.Cloud.beforeFind(Control, ({ query }) => {
  query._include.includes('all') && query.include(['company', 'companyPerson', 'departureLists', 'docs'])
})

Parse.Cloud.afterFind(Control, async ({ query, objects: controls }) => {
  for (const control of controls) {
    const criteria = control.get('criteria') || []
    for (const item of criteria) {
      if (['Tag', 'Company', 'Contract', 'Booking'].includes(item.type)) {
        item.item = await $getOrFail(item.type, item.value)
          .then(obj => ({ ...obj.toJSON(), className: item.type }))
      }
    }
    control.set('criteria', criteria)
    control.set('cubesQuery', getCubesQuery(control).toJSON())
  }
  if (query._include.includes('departureLists')) {
    const departureLists = await $query(DepartureList).containedIn('control', controls).limit(1000).find({ useMasterKey: true })
    for (const control of controls) {
      control.set('departureLists', departureLists.filter(s => s.get('control').id === control.id))
    }
  }
  if (query._include.includes('departureListCount')) {
    for (const control of controls) {
      control.set('departureListCount', await $query(DepartureList).equalTo('control', control).count({ useMasterKey: true }))
    }
  }
})

Parse.Cloud.afterDelete(Control, $deleteAudits)

Parse.Cloud.define('control-create', async ({
  params: {
    name,
    date,
    lastControlBefore,
    criteria
  }, user
}) => {
  const control = new Control({
    name,
    date,
    lastControlBefore,
    criteria
  })

  const audit = { user, fn: 'control-create' }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('control-update', async ({
  params: {
    id: controlId,
    name,
    date,
    lastControlBefore,
    criteria
  }, user
}) => {
  const control = await $getOrFail(Control, controlId)
  const changes = $changes(control, { name, date, lastControlBefore, criteria })
  control.set({ name, date, lastControlBefore, criteria })
  const audit = { user, fn: 'control-update', data: { changes } }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('control-add-lists', async ({ params: { id: controlId, lists }, user }) => {
  const control = await $getOrFail(Control, controlId)
  for (const stateId of Object.keys(lists || {})) {
    const placeKey = '_' + stateId
    let departureList = await $query('DepartureList')
      .equalTo('control', control)
      .equalTo('placeKey', placeKey)
      .first({ useMasterKey: true })
    if (!departureList) {
      const [, stateId] = placeKey.split('_')
      const state = await $getOrFail('State', stateId)
      const name = `${control.get('name')} (${state.get('name')})`
      consola.info({ name })
      departureList = new DepartureList({
        name,
        type: 'control',
        control,
        placeKey,
        cubeIds: lists[stateId]
      })
      const audit = { user, fn: 'departure-list-generate' }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
      continue
    }
    const cubeIds = [...new Set([...(departureList.get('cubeIds') || []), ...lists[stateId]])]
    const cubeChanges = $cubeChanges(departureList, cubeIds)
    if (cubeChanges) {
      departureList.set({ cubeIds })
      const audit = { user, fn: 'departure-list-update', data: { cubeChanges } }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  return true
}, { requireUser: true })

Parse.Cloud.define('control-remove', async ({ params: { id: controlId }, user, context: { seedAsId } }) => {
  const control = await $getOrFail(Control, controlId)
  if (control.get('status')) {
    throw new Error('Only draft controls can be deleted!')
  }
  while (true) {
    const departureLists = await $query('DepartureList')
      .equalTo('control', control)
      .find({ useMasterKey: true })
    if (!departureLists.length) {
      break
    }
    await Promise.all(departureLists.map((sl) => {
      return sl.get('status')
        ? sl.unset('control').save(null, { useMasterKey: true })
        : sl.destroy({ useMasterKey: true })
    }))
  }
  return control.destroy({ useMasterKey: true })
}, { requireUser: true })
