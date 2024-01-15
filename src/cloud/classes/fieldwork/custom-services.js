const CustomService = Parse.Object.extend('CustomService')
const TaskList = Parse.Object.extend('TaskList')
const { getStatusAndCounts } = require('./task-lists')

Parse.Cloud.beforeSave(CustomService, async ({ object: customService, context: { syncStatus } }) => {
  !customService.get('status') && customService.set('status', 0)

  if (customService.isNew()) { return }
  if (syncStatus || !customService.get('counts')) {
    const { status, counts } = await getStatusAndCounts({ customService })
    customService.set({ status, counts })
  }
})

Parse.Cloud.afterSave(CustomService, async ({ object: customService, context: { audit } }) => {
  const { date, dueDate } = customService.attributes
  await Parse.Query.or(
    $query('TaskList').notEqualTo('date', date),
    $query('TaskList').notEqualTo('dueDate', dueDate)
  )
    .equalTo('customService', customService)
    .each(dl => dl.set({ date, dueDate }).save(null, { useMasterKey: true }), { useMasterKey: true })
  $audit(customService, audit)
})

Parse.Cloud.beforeFind(CustomService, ({ query }) => {
  query._include.includes('all') && query.include(['company', 'docs'])
})

Parse.Cloud.afterFind(CustomService, async ({ query, objects: customServices }) => {
  const pipeline = [
    { $match: { _p_customService: { $in: customServices.map(b => 'CustomService$' + b.id) } } },
    { $group: { _id: '$customService', taskListCount: { $sum: 1 }, cubeCount: { $sum: '$cubeCount' } } }
  ]
  const counts = await $query(TaskList).aggregate(pipeline)
    .then(response => response.reduce((acc, { objectId, taskListCount, cubeCount }) => ({ ...acc, [objectId]: { taskListCount, cubeCount } }), {}))
  for (const customService of customServices) {
    customService.set(counts[customService.id])
  }
})

Parse.Cloud.beforeDelete(CustomService, async ({ object: customService }) => {
  const wipListExists = await $query(TaskList)
    .equalTo('customService', customService)
    .greaterThan('status', 0)
    .find({ useMasterKey: true })
  if (wipListExists.length) {
    throw new Error('Sonderdiensleistungen mit geplanten Listen kann nicht gelöscht werden.')
  }
  await $query('TaskList')
    .equalTo('customService', customService)
    .equalTo('status', 0)
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        await taskList.destroy({ useMasterKey: true })
      }
    }, { useMasterKey: true })
})

Parse.Cloud.afterDelete(CustomService, $deleteAudits)

Parse.Cloud.define('custom-service-create', async ({
  params: {
    type,
    name,
    companyId,
    date,
    dueDate
  }, user
}) => {
  if (type !== 'special-format') {
    throw new Error('CustomService type not supported!')
  }
  const customService = new CustomService({
    type,
    name,
    company: companyId ? await $getOrFail('Company', companyId) : undefined,
    date,
    dueDate
  })

  const audit = { user, fn: 'custom-service-create' }
  return customService.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('custom-service-update', async ({
  params: {
    id: customServiceId,
    name,
    companyId,
    date,
    dueDate
  }, user
}) => {
  const customService = await $getOrFail(CustomService, customServiceId)
  const changes = $changes(customService, { name, date, dueDate })
  customService.set({ name, date, dueDate })
  if (companyId !== customService.get('company')?.id) {
    changes.companyId = [customService.get('company')?.id, companyId]
    const company = companyId ? await $getOrFail('Company', companyId) : null
    company ? customService.set('company', company) : customService.unset('company')
  }
  const audit = { user, fn: 'custom-service-update', data: { changes } }
  return customService.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('custom-service-add-lists', async ({ params: { id: customServiceId, lists }, user }) => {
  const customService = await $getOrFail(CustomService, customServiceId)
  const date = customService.get('date')
  const dueDate = customService.get('dueDate')
  if (!date || !dueDate) {
    throw new Error('CustomService has no date or due date!')
  }
  for (const placeKey of Object.keys(lists || {})) {
    const [stateId, ort] = placeKey.split(':')
    const state = $pointer('State', stateId)
    let taskList = await $query('TaskList')
      .equalTo('customService', customService)
      .equalTo('ort', ort)
      .equalTo('state', state)
      .first({ useMasterKey: true })
    if (!taskList) {
      taskList = new TaskList({
        type: customService.get('type'),
        customService,
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

Parse.Cloud.define('custom-service-add-location', async ({ params: { id: customServiceId, placeKey, withCubes }, user }) => {
  const customService = await $getOrFail(CustomService, customServiceId)
  const date = customService.get('date')
  const dueDate = customService.get('dueDate')
  if (!date || !dueDate) {
    throw new Error('CustomService has no date or due date!')
  }

  const [stateId, ort] = placeKey.split(':')
  const state = $pointer('State', stateId)
  let taskList = await $query('TaskList')
    .equalTo('customService', customService)
    .equalTo('ort', ort)
    .equalTo('state', state)
    .first({ useMasterKey: true })

  const cubeIds = withCubes && await $query('Cube')
    .equalTo('ort', ort)
    .equalTo('state', state)
    .equalTo('dAt', null)
    .equalTo('pair', null)
    .distinct('objectId', { useMasterKey: true })

  if (taskList) {
    if (!cubeIds) {
      throw new Error('Ort bereits hinzugefügt.')
    }
    const cubeChanges = $cubeChanges(taskList, cubeIds)
    if (!cubeChanges) {
      throw new Error('Ort bereits hinzugefügt, keine Änderungen.')
    }
    taskList.set({ cubeIds })
    const audit = { user, fn: 'task-list-update', data: { cubeChanges } }
    return {
      message: `${cubeIds.length} CityCubes in ${ort} hinzugefügt.`,
      data: await taskList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  taskList = new TaskList({
    type: 'special-format',
    customService,
    ort,
    state,
    date,
    dueDate,
    cubeIds: cubeIds || []
  })
  const audit = { user, fn: 'task-list-generate' }
  return {
    message: cubeIds ? `${ort} mit ${cubeIds.length} CityCubes hinzugefügt.` : `${ort} hinzugefügt.`,
    data: await taskList.save(null, { useMasterKey: true, context: { audit } })
  }
}, $fieldworkManager)

Parse.Cloud.define('custom-service-mark-as-planned', async ({ params: { id: customServiceId }, user }) => {
  const customService = await $getOrFail(CustomService, customServiceId)
  if (customService.get('status') > 0) {
    throw new Error('Sonderdiensleistung was already planned!')
  }
  const taskListAudit = { user, fn: 'task-list-plan' }
  await $query('TaskList')
    .equalTo('customService', customService)
    .equalTo('status', 0)
    .eachBatch(async (records) => {
      for (const record of records) {
        await record.set('status', 0.1).save(null, { useMasterKey: true, context: { audit: taskListAudit } })
      }
    }, { useMasterKey: true })
  const audit = { user, fn: 'custom-service-mark-as-planned' }
  customService.set({ status: 1 })
  return customService.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('custom-service-revert', async ({ params: { id: customServiceId }, user }) => {
  const customService = await $getOrFail(CustomService, customServiceId)
  if (customService.get('status') !== 1) {
    throw new Error('Nur geplante Sonderdiensleistungen können zurückgezogen werden.')
  }
  const counts = customService.get('counts')
  if (counts.completed || counts.rejected) {
    throw new Error('Sonderdiensleistungen mit erledigten Listen können nicht zurückgezogen werden.')
  }
  await $query('TaskList')
    .equalTo('customService', customService)
    .select('statuses')
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        if (Object.keys(taskList.get('statuses')).length) {
          throw new Error('Sonderdiensleistungen mit erledigten Listen können nicht zurückgezogen werden.')
        }
      }
    }, { useMasterKey: true })

  const taskListAudit = { user, fn: 'task-list-revert' }
  await $query('TaskList')
    .equalTo('customService', customService)
    .notEqualTo('status', 0)
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        await taskList.set('status', 0).save(null, { useMasterKey: true, context: { audit: taskListAudit } })
      }
    }, { useMasterKey: true })

  const audit = { user, fn: 'custom-service-revert' }
  return customService.set({ status: 0 }).save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('custom-service-remove', async ({ params: { id: customServiceId }, user }) => {
  const customService = await $getOrFail(CustomService, customServiceId)
  return customService.destroy({ useMasterKey: true })
}, $fieldworkManager)

// removed booked cubes from draft customService
Parse.Cloud.define('custom-service-remove-booked-cubes', async ({ params: { id: customServiceId }, user }) => {
  const customService = await $getOrFail(CustomService, customServiceId)
  // TOTRANSLATE
  if (customService.get('status') !== 0) {
    throw new Error('Sonderdiensleistung is not a draft!')
  }
  return $query('TaskList')
    .equalTo('customService', customService)
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
        const audit = { user, fn: 'task-list-update', data: { cubeChanges, removedBooked: true } }
        return taskList.save(null, { useMasterKey: true, context: { audit } })
      }
    }, { useMasterKey: true })
}, $fieldworkManager)

// removes newly booked cube from customServices that are running
Parse.Cloud.define('custom-service-remove-booked-cube', async ({ params: { cubeId } }) => {
  return $query('TaskList')
    .equalTo('type', 'special-format')
    .equalTo('cubeIds', cubeId)
    .containedIn(`statuses.${cubeId}`, [null, 'approvable'])
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

Parse.Cloud.define('custom-service-generate-special-format', async ({ params: { id: customServiceId }, user }) => {
  const customService = await $getOrFail('CustomService', customServiceId, ['company'])
  const company = customService.get('company')
  const getTaskListsQuery = () => $query('TaskList').equalTo('customService', customService)

  const sfCounts = {}
  await $query('SpecialFormatSubmission')
    .matchesQuery('taskList', getTaskListsQuery())
    .equalTo('status', 'approved')
    .greaterThan('quantity', 0)
    .select(['cube', 'quantity'])
    .eachBatch((submissions) => {
      for (const submission of submissions) {
        sfCounts[submission.get('cube').id] = parseInt(submission.get('quantity'))
      }
    }, { useMasterKey: true })
  const cubeIds = Object.keys(sfCounts)
  cubeIds.sort()

  const SpecialFormat = Parse.Object.extend('SpecialFormat')
  const specialFormat = new SpecialFormat({
    cubeIds,
    sfCounts,
    status: 2,
    company,
    customService,
    campaignNo: customService.get('name')
  })
  const audit = { user, fn: 'special-format-generate' }
  return specialFormat.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)
