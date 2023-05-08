const Control = Parse.Object.extend('Control')
const TaskList = Parse.Object.extend('TaskList')

function getCubesQuery (control) {
  const { date, dueDate, lastControlBefore, criteria } = control.attributes

  const extendsDuringControlPeriod = $query('Cube')
    .equalTo('order.earlyCanceledAt', null) // not early canceled
    .equalTo('order.canceledAt', null) // not canceled
    .notEqualTo('order.autoExtendsBy', null)
    .greaterThan('order.endsAt', date)
    .lessThanOrEqualTo('order.endsAt', dueDate)
  const endDateAfterControlPeriod = $query('Cube').greaterThan('order.endsAt', dueDate)

  // order status is active, canceled or ended
  let cubesQuery = Parse.Query.or(extendsDuringControlPeriod, endDateAfterControlPeriod)
    .greaterThan('order.status', 2)
    .lessThan('order.startsAt', date)

  // filter out cubes that were controlled in the last x months
  if (lastControlBefore) {
    const lastControlAt = moment(date).subtract(lastControlBefore, 'months').toDate()
    const lastControlQuery = Parse.Query.or(
      $query('Cube').doesNotExist('cAt'),
      $query('Cube').lessThan('cAt', lastControlAt)
    )
    cubesQuery = Parse.Query.and(cubesQuery, lastControlQuery)
  }

  const filters = {
    placeKey: { include: [], exclude: [] },
    State: { include: [], exclude: [] },
    Tag: { include: [], exclude: [] },
    Company: { include: [], exclude: [] },
    Contract: { include: [], exclude: [] },
    Booking: { include: [], exclude: [] }
  }

  for (const criterion of criteria || []) {
    filters[criterion.type][criterion.op].push(criterion.value)
  }

  if (filters.placeKey.include.length) {
    const placesQuery = filters.placeKey.include.map((placeKey) => {
      const [stateId, ort] = placeKey.split(':')
      return $query('Cube').equalTo('ort', ort).equalTo('state', $parsify('State', stateId))
    })
    cubesQuery = Parse.Query.and(cubesQuery, Parse.Query.or(...placesQuery))
  }
  if (filters.placeKey.exclude.length) {
    const placesQuery = filters.placeKey.exclude.map((placeKey) => {
      const [stateId, ort] = placeKey.split(':')
      return $query('Cube').equalTo('ort', ort).equalTo('state', $parsify('State', stateId))
    })
    cubesQuery = Parse.Query.and(cubesQuery, Parse.Query.nor(...placesQuery))
  }
  if (filters.State.include.length) {
    const statesQuery = filters.State.include.map((stateId) => {
      return $query('Cube').equalTo('state', $parsify('State', stateId))
    })
    cubesQuery = Parse.Query.and(cubesQuery, Parse.Query.or(...statesQuery))
  }
  if (filters.State.exclude.length) {
    const statesQuery = filters.State.exclude.map((stateId) => {
      return $query('Cube').equalTo('state', $parsify('State', stateId))
    })
    cubesQuery = Parse.Query.and(cubesQuery, Parse.Query.nor(...statesQuery))
  }
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

Parse.Cloud.beforeSave(Control, ({ object: control }) => {
  !control.get('status') && control.set('status', 0)
})

Parse.Cloud.afterSave(Control, ({ object: control, context: { audit } }) => { $audit(control, audit) })

Parse.Cloud.beforeFind(Control, ({ query }) => {
  query._include.includes('all') && query.include(['criteria', 'docs'])
})

Parse.Cloud.afterFind(Control, async ({ query, objects: controls }) => {
  for (const control of controls) {
    !control.get('cubeIds') && control.set('cubeIds', [])
    !control.get('addedCubeIds') && control.set('addedCubeIds', [])
    !control.get('skippedCubeIds') && control.set('skippedCubeIds', [])
  }

  if (query._include.includes('criteria')) {
    for (const control of controls) {
      const criteria = control.get('criteria') || []
      for (const item of criteria) {
        if (['State', 'Tag', 'Company', 'Contract', 'Booking'].includes(item.type)) {
          item.item = await $getOrFail(item.type, item.value)
            .then(obj => ({ ...obj.toJSON(), className: item.type }))
        }
      }
      control.set('criteria', criteria)
      control.set('cubesQuery', getCubesQuery(control).toJSON())
    }
  }
  const pipeline = [
    { $match: { _p_control: { $in: controls.map(c => 'Control$' + c.id) } } },
    { $group: { _id: '$control', taskListCount: { $sum: 1 }, cubeCount: { $sum: '$cubeCount' } } }
  ]
  const counts = await $query(TaskList).aggregate(pipeline)
    .then(response => response.reduce((acc, { objectId, taskListCount, cubeCount }) => ({ ...acc, [objectId]: { taskListCount, cubeCount } }), {}))
  for (const control of controls) {
    control.set(counts[control.id])
  }
})

Parse.Cloud.afterDelete(Control, $deleteAudits)

Parse.Cloud.define('control-create', async ({
  params: {
    name,
    date,
    dueDate
  }, user
}) => {
  const control = new Control({
    name,
    date,
    dueDate,
    status: 1
  })

  const audit = { user, fn: 'control-create' }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('control-update', async ({
  params: {
    id: controlId,
    name,
    date,
    dueDate
  }, user
}) => {
  const control = await $getOrFail(Control, controlId)
  const changes = $changes(control, { name, date, dueDate })
  control.set({ name, date, dueDate, status: 1 })
  const audit = { user, fn: 'control-update', data: { changes } }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('control-update-criteria', async ({
  params: {
    id: controlId,
    criteria
  }, user
}) => {
  const control = await $getOrFail(Control, controlId)
  control.set({ criteria })
  const audit = { user, fn: 'control-update-criteria' }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('control-freeze-criteria', async ({
  params: {
    id: controlId
  }, user
}) => {
  const control = await $getOrFail(Control, controlId)
  const cubesQuery = getCubesQuery(control)
  const cubeIds = await cubesQuery.distinct('objectId', { useMasterKey: true })
  control.set({ cubeIds, status: 2 })
  const audit = { user, fn: 'control-freeze-criteria' }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('control-add-lists', async ({ params: { id: controlId, lists }, user }) => {
  const control = await $getOrFail(Control, controlId)
  const cubeIds = control.get('cubeIds') || []
  const addedCubeIds = control.get('addedCubeIds') || []
  const skippedCubeIds = control.get('skippedCubeIds') || []
  const { date, dueDate } = control.attributes

  const finalCubeIds = [...cubeIds, ...addedCubeIds].filter(id => !skippedCubeIds.includes(id))

  const cubes = await $query('Cube')
    .containedIn('objectId', finalCubeIds)
    .select(['objectId', 'ort', 'state'])
    .limit(finalCubeIds.length)
    .find({ useMasterKey: true })
  const locations = {}
  for (const cube of cubes) {
    const stateId = cube.get('state')?.id
    const ort = cube.get('ort')
    const placeKey = [stateId, ort].join(':')
    if (!locations[placeKey]) {
      locations[placeKey] = []
    }
    locations[placeKey].push(cube.id)
  }
  for (const placeKey of Object.keys(locations)) {
    const [stateId, ort] = placeKey.split(':')
    const state = await $getOrFail('State', stateId)
    let taskList = await $query('TaskList')
      .equalTo('control', control)
      .equalTo('state', state)
      .equalTo('ort', ort)
      .first({ useMasterKey: true })
    if (!taskList) {
      taskList = new TaskList({
        type: 'control',
        control,
        state,
        ort,
        date,
        dueDate,
        cubeIds: locations[placeKey]
      })
      const audit = { user, fn: 'task-list-generate' }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
      continue
    }
    const cubeIds = [...new Set([...(taskList.get('cubeIds') || []), ...locations[stateId]])]
    const cubeChanges = $cubeChanges(taskList, cubeIds)
    if (cubeChanges) {
      taskList.set({ cubeIds })
      const audit = { user, fn: 'task-list-update', data: { cubeChanges } }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  return control.set('status', 3).save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('control-remove', async ({ params: { id: controlId }, user, context: { seedAsId } }) => {
  const control = await $getOrFail(Control, controlId)
  if (await $query('TaskList').equalTo('control', control).greaterThan('status', 2).first({ useMasterKey: true })) {
    throw new Error('Controls with appointed task lists cannot be deleted!')
  }
  await $query('TaskList')
    .equalTo('control', control)
    .each(dl => dl.destroy({ useMasterKey: true }), { useMasterKey: true })
  return control.destroy({ useMasterKey: true })
}, { requireUser: true })

// $query('TaskList')
//   .equalTo('type', 'control')
//   .equalTo('cubeCount', 0)
//   .each(dl => dl.destroy({ useMasterKey: true }), { useMasterKey: true })
//   .then(consola.success)
