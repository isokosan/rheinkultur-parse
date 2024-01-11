const Briefing = Parse.Object.extend('Briefing')
const TaskList = Parse.Object.extend('TaskList')
const { difference } = require('lodash')
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

Parse.Cloud.define('briefing-add-location', async ({ params: { id: briefingId, placeKey, withCubes }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  const date = briefing.get('date')
  const dueDate = briefing.get('dueDate')
  if (!date || !dueDate) {
    throw new Error('Briefing has no date or due date!')
  }

  const [stateId, ort] = placeKey.split(':')
  const state = $pointer('State', stateId)
  let taskList = await $query('TaskList')
    .equalTo('briefing', briefing)
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
    type: 'scout',
    briefing,
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

Parse.Cloud.define('briefing-mark-as-planned', async ({ params: { id: briefingId }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  if (briefing.get('status') > 0) {
    throw new Error('Briefing was already planned!')
  }
  const taskListAudit = { user, fn: 'task-list-plan' }
  await $query('TaskList')
    .equalTo('briefing', briefing)
    .equalTo('status', 0)
    .eachBatch(async (records) => {
      for (const record of records) {
        await record.set('status', 0.1).save(null, { useMasterKey: true, context: { audit: taskListAudit } })
      }
    }, { useMasterKey: true })
  const audit = { user, fn: 'briefing-mark-as-planned' }
  briefing.set({ status: 1 })
  return briefing.save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('briefing-revert', async ({ params: { id: briefingId }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  if (briefing.get('status') !== 1) {
    throw new Error('Nur geplante Briefings können zurückgezogen werden.')
  }
  const counts = briefing.get('counts')
  if (counts.completed || counts.rejected) {
    throw new Error('Briefings mit erledigten Listen können nicht zurückgezogen werden.')
  }
  await $query('TaskList')
    .equalTo('briefing', briefing)
    .select('statuses')
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        if (Object.keys(taskList.get('statuses')).length) {
          throw new Error('Briefings mit erledigten Listen können nicht zurückgezogen werden.')
        }
      }
    }, { useMasterKey: true })

  const taskListAudit = { user, fn: 'task-list-revert' }
  await $query('TaskList')
    .equalTo('briefing', briefing)
    .notEqualTo('status', 0)
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        await taskList.set('status', 0).save(null, { useMasterKey: true, context: { audit: taskListAudit } })
      }
    }, { useMasterKey: true })

  const audit = { user, fn: 'briefing-revert' }
  return briefing.set({ status: 0 }).save(null, { useMasterKey: true, context: { audit } })
}, $fieldworkManager)

Parse.Cloud.define('briefing-remove', async ({ params: { id: briefingId }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  return briefing.destroy({ useMasterKey: true })
}, $fieldworkManager)

// removed booked cubes from draft briefing
Parse.Cloud.define('briefing-remove-booked-cubes', async ({ params: { id: briefingId }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  // TOTRANSLATE
  if (briefing.get('status') !== 0) {
    throw new Error('Briefing is not a draft!')
  }
  return $query('TaskList')
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
        const audit = { user, fn: 'task-list-update', data: { cubeChanges, removedBooked: true } }
        return taskList.save(null, { useMasterKey: true, context: { audit } })
      }
    }, { useMasterKey: true })
}, $fieldworkManager)

Parse.Cloud.define('briefing-approve-verified-cubes', async ({ params: { id: briefingId }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  // TOTRANSLATE
  if (briefing.get('status') !== 0) {
    throw new Error('Briefing is not a draft!')
  }
  let approved = 0
  await $query('TaskList')
    .equalTo('type', 'scout')
    .equalTo('briefing', briefing)
    .equalTo('status', 0)
    .greaterThan('counts.approvable', 0)
    .each(async (taskList) => {
      const cubeIds = taskList.get('cubeIds')
      const adminApprovedCubeIds = taskList.get('adminApprovedCubeIds') || []
      const approvableCubeIds = await $query('Cube')
        .containedIn('objectId', cubeIds)
        .notEqualTo('vAt', null)
        .notEqualTo('media', null)
        .distinct('objectId', { useMasterKey: true })
      const newAdminApprovedCubeIds = [...new Set([...adminApprovedCubeIds, ...approvableCubeIds])]
      const addedApprovedIds = difference(newAdminApprovedCubeIds, adminApprovedCubeIds)
      if (!addedApprovedIds.length) { return }
      const audit = { user, fn: taskList.get('type') + '-submission-preapprove', data: { cubeIds: addedApprovedIds, approved: true } }
      taskList.set({ adminApprovedCubeIds: newAdminApprovedCubeIds })
      await taskList.save(null, { useMasterKey: true, context: { audit } })
      approved += addedApprovedIds.length
    }, { useMasterKey: true })
  return approved
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

Parse.Cloud.define('briefing-report', async ({ params: { id: briefingId }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  const report = {}
  await $query('TaskList')
    .equalTo('briefing', briefing)
    .select(['pk', 'results', 'selectionRatings'])
    .each(async (taskList) => {
      const selections = {}
      for (const rating of Object.values(taskList.get('selectionRatings') || {})) {
        selections[rating] = (selections[rating] || 0) + 1
      }
      const pkReport = taskList.get('results') || {}
      if ($cleanDict(selections)) {
        pkReport.selections = selections
      }
      report[taskList.get('pk')] = pkReport
    }, { useMasterKey: true })
  return report
}, $fieldworkManager)

Parse.Cloud.define('briefing-generate', async ({ params: { id: briefingId, type, includeCubes }, user }) => {
  const briefing = await $getOrFail('Briefing', briefingId, ['company'])
  const company = briefing.get('company')
  const getTaskListsQuery = () => $query('TaskList').equalTo('briefing', briefing)

  const cubeIds = []
  // pre-approved verified cubes
  if (includeCubes === 'approved') {
    const adminApprovedCubeIds = await getTaskListsQuery().distinct('adminApprovedCubeIds', { useMasterKey: true })
    const approvedCubeIds = await $query('ScoutSubmission')
      .matchesQuery('taskList', getTaskListsQuery())
      .equalTo('status', 'approved')
      .notEqualTo('form.media', null)
      .distinct('cube', { useMasterKey: true })
      .then(cubes => cubes.map(cube => cube.objectId))
    cubeIds.push(...adminApprovedCubeIds, ...approvedCubeIds)
  }
  let selectionRatings = {}
  if (type === 'Contract' || includeCubes === 'quality') {
    await getTaskListsQuery().select('selectionRatings').eachBatch((lists) => {
      for (const list of lists) {
        selectionRatings = {
          ...selectionRatings,
          ...(list.get('selectionRatings') || {})
        }
      }
    }, { useMasterKey: true })
    if (includeCubes === 'quality') {
      // only include cubeId keys that have a value of '🟢'
      const greenCubeIds = Object.entries(selectionRatings)
        .filter(([, rating]) => rating === '🟢')
        .map(([cubeId]) => cubeId)
      cubeIds.push(...greenCubeIds)
    }
  }

  cubeIds.sort()

  if (type === 'Contract') {
    const Contract = Parse.Object.extend('Contract')
    const contract = new Contract({
      cubeIds,
      selectionRatings,
      status: 2,
      company,
      briefing,
      campaignNo: briefing.get('name')
    })

    if (company) {
      const { paymentType, dueDays } = company.attributes
      const { billingCycle, pricingModel, invoicingAt } = company.get('contractDefaults') || {}
      contract.set({
        tags: contract.get('company').get('tags'),
        address: company.get('address'),
        invoiceAddress: company.get('invoiceAddress'),
        billingCycle: billingCycle || 12,
        invoicingAt: invoicingAt || pricingModel === 'gradual' ? 'end' : 'start',
        paymentType: paymentType || 0,
        dueDays: dueDays || 14,
        pricingModel: pricingModel || null
      })
    }
    const audit = { user, fn: 'contract-generate' }
    return contract.save(null, { useMasterKey: true, context: { audit } })
  }

  if (type === 'FrameMount') {
    const FrameMount = Parse.Object.extend('FrameMount')
    const frameMount = new FrameMount({
      cubeIds,
      status: 2,
      company,
      briefing,
      campaignNo: briefing.get('name')
    })
    const audit = { user, fn: 'frame-mount-generate' }
    return frameMount.save(null, { useMasterKey: true, context: { audit } })
  }
}, $internOrAdmin)
