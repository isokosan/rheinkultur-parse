const { isEqual } = require('lodash')
const Control = Parse.Object.extend('Control')
const ControlReport = Parse.Object.extend('ControlReport')
const TaskList = Parse.Object.extend('TaskList')
const { getStatusAndCounts } = require('./task-lists')
const { ensureUniqueField, round2 } = require('@/utils')

function getCubesQuery (control) {
  const { date, dueDate, lastControlBefore, orderType, criteria } = control.attributes

  const extendsDuringControlPeriod = $query('Cube')
    .equalTo('order.earlyCanceledAt', null) // not early canceled
    .equalTo('order.canceledAt', null) // not canceled
    .notEqualTo('order.autoExtendsBy', null)
    .greaterThan('order.endsAt', date)
    .lessThanOrEqualTo('order.endsAt', dueDate)
  const endDateAfterControlPeriod = $query('Cube').greaterThan('order.endsAt', dueDate)

  // order status is active and started, extends or ends after control date
  let baseQuery = Parse.Query.or(extendsDuringControlPeriod, endDateAfterControlPeriod)
    .greaterThan('order.status', 2)
    .lessThan('order.startsAt', date)

  if (orderType) {
    baseQuery.equalTo('order.className', orderType)
  }

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
    cubesQuery.containedIn('objectId', filters.Cube.include)
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
    // TODO: if changing add audit
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
      const criteria = await Promise.all((control.get('criteria') || []).map(async (item) => {
        if (['State', 'Tag', 'Company', 'Contract', 'Booking', 'Cube'].includes(item.type)) {
          item.item = await $getOrFail(item.type, item.value)
            .then(obj => ({ ...obj.toJSON(), className: item.type }))
        }
        return item
      }))
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

Parse.Cloud.beforeDelete(Control, async ({ object: control }) => {
  const wipListExists = await $query(TaskList)
    .equalTo('control', control)
    .greaterThan('status', 0)
    .find({ useMasterKey: true })
  if (wipListExists.length) {
    throw new Error('Kontrolle mit geplanten Listen kann nicht gelöscht werden.')
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
    dueDate,
    lastControlBefore,
    orderType
  }, user
}) => {
  const control = new Control({
    name,
    date,
    dueDate,
    lastControlBefore,
    orderType
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
    lastControlBefore,
    orderType,
    criteria
  }, user
}) => {
  // normalize
  orderType === 'all' && (orderType = null)

  const control = await $getOrFail(Control, controlId)
  const changes = $changes(control, { name, date, dueDate, lastControlBefore, orderType })
  changes.criteria = getCriteriaChanges(control.get('criteria'), criteria)
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen') }
  control.set({ name, date, dueDate, lastControlBefore, orderType, criteria })
  const audit = { user, fn: 'control-update', data: { changes } }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('control-counts', async ({ params: { id: controlId } }) => {
  const control = await $getOrFail(Control, controlId)
  const cubesQuery = getCubesQuery(control)
  const [
    distinctCubeIds,
    distinctOrderKeys
  ] = await Promise.all([
    cubesQuery.distinct('objectId', { useMasterKey: true }),
    cubesQuery.distinct('caok', { useMasterKey: true })
  ])
  return { cubes: distinctCubeIds.length, orders: distinctOrderKeys.length }
}, $fieldworkManager)

Parse.Cloud.define('control-counts-detailed', async ({ params: { id: controlId } }) => {
  const control = await $getOrFail(Control, controlId)
  const cubesQuery = getCubesQuery(control)
  const response = {}
  await cubesQuery
    .select('order')
    .eachBatch((cubes) => {
      for (const cube of cubes) {
        const companyId = cube.get('order').company.id
        const orderNo = cube.get('order').no
        if (!response[companyId]) {
          response[companyId] = {}
        }
        if (!response[companyId][orderNo]) {
          response[companyId][orderNo] = []
        }
        response[companyId][orderNo].push(cube.id)
      }
    }, { useMasterKey: true })
  const companyCounts = {}
  for (const companyId of Object.keys(response)) {
    companyCounts[companyId] = {
      orders: Object.keys(response[companyId]).length,
      bookings: Object.keys(response[companyId]).filter(no => no[0] === 'B').length,
      contracts: Object.keys(response[companyId]).filter(no => no[0] === 'V').length,
      cubes: Object.values(response[companyId]).reduce((acc, cubes) => acc + cubes.length, 0)
    }
  }
  return companyCounts
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
    .select(['objectId', 'ort', 'state', 'caok'])
    .limit(matchingCubeIds.length)
    .find({ useMasterKey: true })
  const cubeOrderKeys = cubes.reduce((acc, cube) => ({ ...acc, [cube.id]: cube.get('caok') }), {})
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
    const changes = $changes(taskList, { date, dueDate })
    const cubeChanges = $cubeChanges(taskList, cubeIds)

    if ($cleanDict(changes) || cubeChanges) {
      taskList.set({ date, dueDate, cubeIds })
      const audit = { user, fn: 'task-list-update', data: { changes, cubeChanges } }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
    }
  }

  // remove placeKeys not in list
  await $query('TaskList')
    .equalTo('control', control)
    .notContainedIn('pk', Object.keys(locations))
    .each(dl => dl.destroy({ useMasterKey: true }), { useMasterKey: true })

  await control.set('cubeIds', matchingCubeIds).set('cubeOrderKeys', cubeOrderKeys).save(null, { useMasterKey: true })
  return {
    message: `${Object.keys(locations).length} lists generated`
  }
}, $fieldworkManager)

Parse.Cloud.define('control-mark-as-planned', async ({ params: { id: controlId }, user }) => {
  const control = await $getOrFail(Control, controlId)
  if (control.get('status') > 0) {
    throw new Error('Control was already planned!')
  }
  const taskListAudit = { user, fn: 'task-list-plan' }
  await $query('TaskList')
    .equalTo('control', control)
    .equalTo('status', 0)
    .eachBatch(async (records) => {
      for (const record of records) {
        await record.set('status', 0.1).save(null, { useMasterKey: true, context: { audit: taskListAudit } })
      }
    }, { useMasterKey: true })
  const audit = { user, fn: 'control-mark-as-planned' }
  control.set({ status: 1 })
  return control.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('control-revert', async ({ params: { id: controlId }, user }) => {
  const control = await $getOrFail(Control, controlId)
  if (control.get('status') !== 1) {
    throw new Error('Nur geplante Kontrollen können zurückgezogen werden.')
  }
  const counts = control.get('counts')
  if (counts.completed || counts.rejected) {
    throw new Error('Kontrollen mit erledigten Listen können nicht zurückgezogen werden.')
  }
  await $query('TaskList')
    .equalTo('control', control)
    .select('statuses')
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        if (Object.keys(taskList.get('statuses')).length) {
          throw new Error('Kontrollen mit erledigten Listen können nicht zurückgezogen werden.')
        }
      }
    }, { useMasterKey: true })

  const taskListAudit = { user, fn: 'task-list-revert' }
  await $query('TaskList')
    .equalTo('control', control)
    .notEqualTo('status', 0)
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        await taskList.set('status', 0).save(null, { useMasterKey: true, context: { audit: taskListAudit } })
      }
    }, { useMasterKey: true })

  const audit = { user, fn: 'control-revert' }
  return control.set({ status: 0 }).save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('control-remove', async ({ params: { id: controlId }, user }) => {
  const control = await $getOrFail(Control, controlId)
  return control.destroy({ useMasterKey: true })
}, $fieldworkManager)

Parse.Cloud.define('control-summary', async ({ params: { id: controlId }, user }) => {
  const control = await $getOrFail(Control, controlId)
  const summary = {}
  await $query('TaskList')
    .equalTo('control', control)
    .select(['pk', 'results'])
    .each(async (taskList) => {
      summary[taskList.get('pk')] = taskList.get('results') || {}
    }, { useMasterKey: true })
  return summary
}, $fieldworkManager)

Parse.Cloud.beforeSave(ControlReport, async ({ object: report }) => {
  await ensureUniqueField(report, 'control', 'company')
  const submissions = Object.values(report.get('submissions') || {})
  report.set('total', submissions.filter(x => x.status === 'include').reduce((acc, x) => round2(acc + (x.cost || 0)), 0))
  report.set('counts', submissions.reduce((acc, x) => {
    acc[x.status || 'pending'] = (acc[x.status || 'pending'] || 0) + 1
    acc.total = (acc.total || 0) + 1
    return acc
  }, {}))
  report.set('status', !report.get('counts').pending ? 'complete' : null)
})

Parse.Cloud.define('control-generate-reports', async ({ params: { id: controlId }, user }) => {
  const control = await $getOrFail(Control, controlId)
  if (control.get('status') < 4) {
    throw new Error('Control was not yet completed!')
  }
  const companies = {}
  const orderKeys = [...new Set(Object.values(control.get('cubeOrderKeys') || {}))]
  const bookingIds = orderKeys.filter(x => x.startsWith('Booking')).map(x => x.split('$')[1])
  if (bookingIds.length) {
    for (const booking of await $query('Booking')
      .containedIn('objectId', bookingIds)
      .limit(bookingIds.length)
      .select('company')
      .find({ useMasterKey: true })) {
      companies['Booking$' + booking.id] = booking.get('company')
    }
  }
  const contractIds = orderKeys.filter(x => x.startsWith('Contract')).map(x => x.split('$')[1])
  if (contractIds.length) {
    for (const contract of await $query('Contract')
      .containedIn('objectId', contractIds)
      .limit(contractIds.length)
      .select('company')
      .find({ useMasterKey: true })) {
      companies['Contract$' + contract.id] = contract.get('company')
    }
  }
  const reports = {}
  const taskListQuery = $query('TaskList').equalTo('control', control)
  await $query('ControlSubmission')
    .matchesQuery('taskList', taskListQuery)
    .containedIn('condition', ['no_ad', 'ill'])
    .select(['objectId', 'condition', 'orderKey'])
    .eachBatch((submissions) => {
      for (const submission of submissions) {
        const companyId = companies[submission.get('orderKey')].id
        if (!reports[companyId]) {
          reports[companyId] = {
            company: companies[submission.get('orderKey')].toPointer(),
            submissions: {}
          }
        }
        reports[companyId].submissions[submission.id] = {}
      }
    }, { useMasterKey: true })

  for (const { company, submissions } of Object.values(reports)) {
    const report = new ControlReport({ control, company, submissions })
    await report.save(null, { useMasterKey: true }).catch(consola.error)
  }
}, $fieldworkManager)

Parse.Cloud.define('control-report-submission', async ({ params: { id: reportId, submissionId, ...form }, user }) => {
  const report = await $getOrFail(ControlReport, reportId)
  const submissions = report.get('submissions')
  const submission = submissions[submissionId]
  if (!submission) {
    throw new Error('Submission not found')
  }
  const { include, comments, cost } = form
  submissions[submissionId] = {
    comments: comments?.trim(),
    cost,
    status: include ? 'include' : 'exclude'
  }
  !submissions[submissionId].cost && delete submissions[submissionId].cost
  await report.set({ submissions }).save(null, { useMasterKey: true })
  return {
    submissions: report.get('submissions'),
    total: report.get('total'),
    counts: report.get('counts'),
    status: report.get('status')
  }
}, $fieldworkManager)
