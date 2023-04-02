const Briefing = Parse.Object.extend('Briefing')
const TaskList = Parse.Object.extend('TaskList')

Parse.Cloud.beforeSave(Briefing, ({ object: briefing }) => {
  !briefing.get('status') && briefing.set('status', 0)
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
    .greaterThanOrEqualTo('status', 3)
    .find({ useMasterKey: true })
  if (wipListExists.length) {
    throw new Error('There are work in progress lists inside this briefing')
  }
  throw new Error('Not working yet')
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
}, { requireUser: true })

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
}, { requireUser: true })

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
}, { requireUser: true })

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
}, { requireUser: true })

Parse.Cloud.define('briefing-remove', async ({ params: { id: briefingId }, user, context: { seedAsId } }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  return briefing.destroy({ useMasterKey: true })
}, $adminOnly)