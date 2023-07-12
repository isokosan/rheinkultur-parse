const { isEqual } = require('lodash')
const Control = Parse.Object.extend('Control')
const TaskList = Parse.Object.extend('TaskList')
const { getStatusAndCounts } = require('./task-lists')

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
  let baseQuery = Parse.Query.or(extendsDuringControlPeriod, endDateAfterControlPeriod)
    .greaterThan('order.status', 2)
    .lessThan('order.startsAt', date)
    // filter out cubes that were controlled in the last x months
  if (lastControlBefore) {
    const lastControlAt = moment(date).subtract(lastControlBefore, 'months').toDate()
    const lastControlQuery = Parse.Query.or(
      $query('Cube').doesNotExist('cAt'),
      $query('Cube').lessThan('cAt', lastControlAt)
    )
    baseQuery = Parse.Query.and(baseQuery, lastControlQuery)
  }

  const filters = {
    placeKey: { include: [], exclude: [] },
    State: { include: [], exclude: [] },
    Tag: { include: [], exclude: [] },
    Company: { include: [], exclude: [] },
    Contract: { include: [], exclude: [] },
    Booking: { include: [], exclude: [] },
    Cube: { include: [], exclude: [] }
  }

  let cubesQuery = $query('Cube')
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
  if (filters.Cube.include.length) {
    cubesQuery = Parse.Query.or(
      $query('Cube').containedIn('objectId', filters.Cube.include),
      cubesQuery
    )
  }
  if (filters.Cube.exclude.length) {
    cubesQuery.notContainedIn('objectId', filters.Cube.exclude)
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
  return Parse.Query.and(baseQuery, cubesQuery)
}

Parse.Cloud.beforeSave(Control, async ({ object: control, context: { syncStatus } }) => {
  !control.get('status') && control.set('status', 0)

  // make sure criteria items are cleaned
  if (control.get('criteria')) {
    const criteria = control.get('criteria') || []
    for (const criterium of criteria) {
      delete criterium.item
    }
    control.set({ criteria })
  }

  if (control.isNew()) { return }
  if (syncStatus || !control.get('counts')) {
    const { status, counts } = await getStatusAndCounts({ control })
    control.set({ status, counts })
  }
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
        if (['State', 'Tag', 'Company', 'Contract', 'Booking', 'Cube'].includes(item.type)) {
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

// TOTRANSLATE
Parse.Cloud.beforeDelete(Control, async ({ object: control }) => {
  const wipListExists = await $query(TaskList)
    .equalTo('control', control)
    .greaterThan('status', 0)
    .find({ useMasterKey: true })
  if (wipListExists.length) {
    throw new Error('There are work in progress lists inside this control')
  }
  await $query('TaskList')
    .equalTo('control', control)
    .equalTo('status', 0)
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        await taskList.destroy({ useMasterKey: true })
      }
    }, { useMasterKey: true })
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
    dueDate
  })

  const audit = { user, fn: 'control-create' }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

function getCriteriaChanges (before, after) {
  const beforeKeys = []
  const afterKeys = []
  for (const { type, value, op } of before || []) {
    beforeKeys.push([type, value, op].join(':'))
  }
  for (const { type, value, op } of after || []) {
    afterKeys.push([type, value, op].join(':'))
  }
  return isEqual(beforeKeys, afterKeys)
    ? undefined
    : [beforeKeys.length ? beforeKeys : null, afterKeys.length ? afterKeys : null]
}

Parse.Cloud.define('control-update', async ({
  params: {
    id: controlId,
    name,
    date,
    dueDate,
    criteria
  }, user
}) => {
  const control = await $getOrFail(Control, controlId)
  const changes = $changes(control, { name, date, dueDate })
  changes.criteria = getCriteriaChanges(control.get('criteria'), criteria)
  control.set({ name, date, dueDate, criteria })
  const audit = { user, fn: 'control-update', data: { changes } }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

// This is only for generation. For syncing (removing cubes, do a sync function)
Parse.Cloud.define('control-generate-lists', async ({ params: { id: controlId }, user }) => {
  const control = await $getOrFail(Control, controlId)
  if (control.get('status')) {
    throw new Error('This control was already planned. You may sync the lists instead to remove cubes that are freed')
  }
  const cubesQuery = getCubesQuery(control)
  const matchingCubeIds = await cubesQuery.distinct('objectId', { useMasterKey: true })
  const { date, dueDate } = control.attributes

  const cubes = await $query('Cube')
    .containedIn('objectId', matchingCubeIds)
    .select(['objectId', 'ort', 'state'])
    .limit(matchingCubeIds.length)
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
    const cubeIds = locations[placeKey]
    if (placeKey === 'NW:Hilden') {
      consola.warn(cubeIds)
    }
    const changes = $changes(taskList, { date, dueDate })
    const cubeChanges = $cubeChanges(taskList, cubeIds)

    if (changes || cubeChanges) {
      taskList.set({ date, dueDate, cubeIds })
      const audit = { user, fn: 'task-list-update', data: { changes, cubeChanges } }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
    }
  }

  // remove placeKeys not in list
  consola.warn('removing missing')
  await $query('TaskList')
    .equalTo('control', control)
    .notContainedIn('pk', Object.keys(locations))
    .each(dl => dl.destroy({ useMasterKey: true }), { useMasterKey: true })

  await control.set('cubeIds', matchingCubeIds).save(null, { useMasterKey: true })
  return {
    message: `${Object.keys(locations).length} lists generated`
  }
}, $fieldworkManager)

Parse.Cloud.define('control-mark-as-planned', async ({ params: { id: controlId }, user }) => {
  const control = await $getOrFail(Control, controlId)
  if (control.get('status') > 0) {
    throw new Error('Control was already planned!')
  }
  await $query('TaskList')
    .equalTo('control', control)
    .equalTo('status', 0)
    .eachBatch(async (records) => {
      for (const record of records) {
        await record.set('status', 0.1).save(null, { useMasterKey: true })
      }
    }, { useMasterKey: true })
  const audit = { user, fn: 'control-mark-as-planned' }
  control.set({ status: 1 })
  return control.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('control-remove', async ({ params: { id: controlId }, user, context: { seedAsId } }) => {
  const control = await $getOrFail(Control, controlId)
  return control.destroy({ useMasterKey: true })
}, $fieldworkManager)
