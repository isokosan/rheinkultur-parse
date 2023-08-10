const Briefing = Parse.Object.extend('Briefing')
const TaskList = Parse.Object.extend('TaskList')
const { getStatusAndCounts } = require('./task-lists')

Parse.Cloud.beforeSave(Briefing, async ({ object: briefing, context: { syncStatus } }) => {
  !briefing.get('status') && briefing.set('status', 0)

  if (briefing.isNew()) { return }
  if (syncStatus || !briefing.get('counts')) {
    const { status, counts } = await getStatusAndCounts({ briefing })
    briefing.set({ status, counts })
  }
})

Parse.Cloud.afterSave(Briefing, async ({ object: briefing, context: { audit } }) => {
  const { date, dueDate } = briefing.attributes
  await Parse.Query.or(
    $query('TaskList').notEqualTo('date', date),
    $query('TaskList').notEqualTo('dueDate', dueDate)
  )
    .equalTo('briefing', briefing)
    .each(dl => dl.set({ date, dueDate }).save(null, { useMasterKey: true }), { useMasterKey: true })
  $audit(briefing, audit)
})

Parse.Cloud.beforeFind(Briefing, ({ query }) => {
  query._include.includes('all') && query.include(['company', 'docs'])
})

Parse.Cloud.afterFind(Briefing, async ({ query, objects: briefings }) => {
  const pipeline = [
    { $match: { _p_briefing: { $in: briefings.map(b => 'Briefing$' + b.id) } } },
    { $group: { _id: '$briefing', taskListCount: { $sum: 1 }, cubeCount: { $sum: '$cubeCount' } } }
  ]
  const counts = await $query(TaskList).aggregate(pipeline)
    .then(response => response.reduce((acc, { objectId, taskListCount, cubeCount }) => ({ ...acc, [objectId]: { taskListCount, cubeCount } }), {}))
  for (const briefing of briefings) {
    briefing.set(counts[briefing.id])
  }
})

Parse.Cloud.beforeDelete(Briefing, async ({ object: briefing }) => {
  const wipListExists = await $query(TaskList)
    .equalTo('briefing', briefing)
    .greaterThan('status', 0)
    .find({ useMasterKey: true })
  if (wipListExists.length) {
    throw new Error('Briefing mit geplanten Listen kann nicht gelöscht werden.')
  }
  await $query('TaskList')
    .equalTo('briefing', briefing)
    .equalTo('status', 0)
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        await taskList.destroy({ useMasterKey: true })
      }
    }, { useMasterKey: true })
})

Parse.Cloud.afterDelete(Briefing, $deleteAudits)

Parse.Cloud.define('briefing-create', async ({
  params: {
    name,
    companyId,
    date,
    dueDate
  }, user
}) => {
  const briefing = new Briefing({
    name,
    company: companyId ? await $getOrFail('Company', companyId) : undefined,
    date,
    dueDate
  })

  const audit = { user, fn: 'briefing-create' }
  return briefing.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('briefing-update', async ({
  params: {
    id: briefingId,
    name,
    companyId,
    date,
    dueDate
  }, user
}) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  const changes = $changes(briefing, { name, date, dueDate })
  briefing.set({ name, date, dueDate })
  if (companyId !== briefing.get('company')?.id) {
    changes.companyId = [briefing.get('company')?.id, companyId]
    const company = companyId ? await $getOrFail('Company', companyId) : null
    company ? briefing.set('company', company) : briefing.unset('company')
  }
  const audit = { user, fn: 'briefing-update', data: { changes } }
  return briefing.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('briefing-add-lists', async ({ params: { id: briefingId, lists }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  const date = briefing.get('date')
  const dueDate = briefing.get('dueDate')
  if (!date || !dueDate) {
    throw new Error('Briefing has no date or due date!')
  }
  for (const placeKey of Object.keys(lists || {})) {
    const [stateId, ort] = placeKey.split(':')
    const state = $pointer('State', stateId)
    let taskList = await $query('TaskList')
      .equalTo('briefing', briefing)
      .equalTo('ort', ort)
      .equalTo('state', state)
      .first({ useMasterKey: true })
    if (!taskList) {
      taskList = new TaskList({
        type: 'scout',
        briefing,
        ort,
        state,
        date,
        dueDate,
        cubeIds: lists[placeKey]
      })
      const audit = { user, fn: 'task-list-generate' }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
      continue
    }
    const cubeIds = [...new Set([...(taskList.get('cubeIds') || []), ...lists[placeKey]])]
    const cubeChanges = $cubeChanges(taskList, cubeIds)
    if (cubeChanges) {
      taskList.set({ cubeIds })
      const audit = { user, fn: 'task-list-update', data: { cubeChanges } }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  return true
}, $fieldworkManager)

Parse.Cloud.define('briefing-add-location', async ({ params: { id: briefingId, placeKey }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  const date = briefing.get('date')
  const dueDate = briefing.get('dueDate')
  if (!date || !dueDate) {
    throw new Error('Briefing has no date or due date!')
  }

  const [stateId, ort] = placeKey.split(':')
  const state = $pointer('State', stateId)
  if (await $query('TaskList')
    .equalTo('briefing', briefing)
    .equalTo('ort', ort)
    .equalTo('state', state)
    .first({ useMasterKey: true })) {
    throw new Error('Location already exists!')
  }
  const taskList = new TaskList({
    type: 'scout',
    briefing,
    ort,
    state,
    date,
    dueDate,
    cubeIds: []
  })
  const audit = { user, fn: 'task-list-generate' }
  return {
    message: `${ort} added.`,
    data: await taskList.save(null, { useMasterKey: true, context: { audit } })
  }
}, $fieldworkManager)

Parse.Cloud.define('briefing-mark-as-planned', async ({ params: { id: briefingId }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  if (briefing.get('status') > 0) {
    throw new Error('Briefing was already planned!')
  }
  await $query('TaskList')
    .equalTo('briefing', briefing)
    .equalTo('status', 0)
    .eachBatch(async (records) => {
      for (const record of records) {
        await record.set('status', 0.1).save(null, { useMasterKey: true })
      }
    }, { useMasterKey: true })
  const audit = { user, fn: 'briefing-mark-as-planned' }
  briefing.set({ status: 1 })
  return briefing.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('briefing-remove', async ({ params: { id: briefingId }, user, context: { seedAsId } }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  return briefing.destroy({ useMasterKey: true })
}, $fieldworkManager)

// removed booked cubes from draft briefing
Parse.Cloud.define('briefing-remove-booked-cubes', async ({ params: { id: briefingId } }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  // TOTRANSLATE
  if (briefing.get('status') !== 0) {
    throw new Error('Briefing is not a draft!')
  }
  return $query('TaskList')
    .equalTo('type', 'scout')
    .equalTo('briefing', briefing)
    .equalTo('status', 0)
    .each(async (taskList) => {
      const activeOrFutureBookingExistsQuery = Parse.Query.or(
        $query('Cube').notEqualTo('order', null),
        $query('Cube').notEqualTo('futureOrder', null)
      )
      const bookedCubeIds = await activeOrFutureBookingExistsQuery
        .containedIn('objectId', taskList.get('cubeIds'))
        .distinct('objectId', { useMasterKey: true })
      const cubeIds = taskList.get('cubeIds').filter((id) => !bookedCubeIds.includes(id))
      const cubeChanges = $cubeChanges(taskList, cubeIds)
      if (cubeChanges) {
        taskList.set({ cubeIds })
        const audit = { fn: 'task-list-update', data: { cubeChanges, removedBooked: true } }
        return taskList.save(null, { useMasterKey: true, context: { audit } })
      }
    }, { useMasterKey: true })
}, $fieldworkManager)

// removes newly booked cube from briefings that are running
Parse.Cloud.define('briefings-remove-booked-cube', async ({ params: { cubeId } }) => {
  return $query('TaskList')
    .equalTo('type', 'scout')
    .equalTo('cubeIds', cubeId)
    .equalTo(`statuses.${cubeId}`, null)
    .greaterThan('status', 0)
    .lessThan('status', 4)
    .each(async (taskList) => {
      const cubeIds = taskList.get('cubeIds').filter(id => id !== cubeId)
      const cubeChanges = $cubeChanges(taskList, cubeIds)
      if (!cubeChanges) {
        throw new Error('Keine Änderungen')
      }
      taskList.set({ cubeIds })
      const audit = { fn: 'task-list-update', data: { cubeChanges, removedBooked: true } }
      return taskList.save(null, { useMasterKey: true, context: { audit } })
    }, { useMasterKey: true })
}, { requireMaster: true })
