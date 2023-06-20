const axios = require('axios')
const {
  intersection
  // sortBy,
  // isEqual
} = require('lodash')

const TaskList = Parse.Object.extend('TaskList')
const Disassembly = Parse.Object.extend('Disassembly')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')

Parse.Cloud.beforeSave(Disassembly, async ({ object: disassembly }) => {
  if (disassembly.get('booking') && disassembly.get('contract')) {
    throw new Error('Disassembly cannot be tied to a booking and a contract simultaneously')
  }
  // make sure the id matches the booking / contract
  const [className, objectId] = disassembly.id.split('-')
  if (disassembly.get(className.toLowerCase()).id !== objectId) {
    throw new Error('Disassembly key does not match booking / contract')
  }

  !disassembly.get('status') && disassembly.set('status', 1)
  disassembly.unset('order')
})

Parse.Cloud.afterSave(Disassembly, async ({ object: disassembly, context: { audit, countStatuses } }) => {
  audit && $audit(disassembly.get('order'), audit)

  if (countStatuses) {
    const taskListsQuery = $query('TaskList')
      .equalTo('contract', disassembly.get('contract'))
      .equalTo('booking', disassembly.get('booking'))
    const statuses = {}
    await $query('DisassemblySubmission')
      .matchesQuery('taskList', taskListsQuery)
      .equalTo('status', 'approved')
      .select(['cube', 'condition'])
      .eachBatch((submissions) => {
        for (const submission of submissions) {
          statuses[submission.get('cube').id] = submission.get('condition')
        }
      }, { useMasterKey: true })
    const order = disassembly.get('order')
    const orderDisassembly = order.get('disassembly')
    orderDisassembly.statuses = $cleanDict(statuses)
    order.set('disassembly', orderDisassembly)
    order.save(null, { useMasterKey: true })
  }
})

Parse.Cloud.beforeFind(Disassembly, ({ query }) => {
  query.include(['contract', 'booking'])
})

Parse.Cloud.afterFind(Disassembly, async ({ query, objects: disassemblies }) => {
  // disassembly tasks
  const pipeline = [
    { $match: { _p_disassembly: { $in: disassemblies.map(c => 'Disassembly$' + c.id) } } },
    { $group: { _id: '$disassembly', taskListCount: { $sum: 1 }, cubeCount: { $sum: '$cubeCount' } } }
  ]
  const counts = await $query(TaskList).aggregate(pipeline)
    .then(response => response.reduce((acc, { objectId, taskListCount, cubeCount }) => ({ ...acc, [objectId]: { taskListCount, cubeCount } }), {}))
  for (const disassembly of disassemblies) {
    disassembly.set(counts[disassembly.id])
    disassembly.set('order', disassembly.get('booking') || disassembly.get('contract'))
    disassembly.set('company', disassembly.get('order').get('company'))
  }
})

Parse.Cloud.beforeDelete(Disassembly, async ({ object: disassembly }) => {
  const remaining = await $query(TaskList)
    .equalTo('disassembly', disassembly)
    .greaterThan('status', 2)
    .count({ useMasterKey: true })
  if (remaining) {
    throw new Error('Cannot delete disassembly with in-progress tasks')
  }
  await $query(TaskList)
    .equalTo('disassembly', disassembly)
    .equalTo('status', 0)
    .each(list => list.destroy({ useMasterKey: true }), { useMasterKey: true })
})

async function ensureDisassemblyExists (order, date, dueDate, type) {
  const disassemblyKey = order.className + '-' + order.id + '-' + date
  const exists = await $query(Disassembly)
    .equalTo('objectId', disassemblyKey)
    .first({ useMasterKey: true })
  if (!exists) {
    await axios({
      method: 'POST',
      url: `${process.env.PUBLIC_SERVER_URL}/classes/Disassembly`,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-Master-Key': process.env.MASTER_KEY
      },
      data: {
        objectId: disassemblyKey,
        date,
        dueDate,
        type,
        booking: order.className === 'Booking' ? $pointer('Booking', order.id) : undefined,
        contract: order.className === 'Contract' ? $pointer('Contract', order.id) : undefined
      }
    })
  }
  return $parsify(Disassembly, disassemblyKey)
}

async function upsertTaskList (attrs) {
  // first check if a departure list with the same unique attrs exists
  // uniqueTogether = { type, booking, contract, ort, state, date }
  const existing = await $query(TaskList)
    .equalTo('type', 'disassembly')
    .equalTo('disassembly', attrs.disassembly)
    .equalTo('ort', attrs.ort)
    .equalTo('state', attrs.state)
    .equalTo('date', attrs.date)
    .find({ useMasterKey: true })
  const [exists, ...duplicates] = existing
  duplicates.length && await Promise.all(duplicates.map((duplicate) => {
    consola.warn('Removing duplicate disassembly tasklist', duplicate.attributes)
    return duplicate.destroy({ useMasterKey: true })
  }))
  if (exists) {
    const cubeChanges = $cubeChanges(exists, attrs.cubeIds)
    if (!cubeChanges) { return exists }
    const audit = { fn: 'task-list-update', data: { cubeChanges } }
    return exists
      .set('cubeIds', attrs.cubeIds)
      .set('adminApprovedCubeIds', [...(exists.get('adminApprovedCubeIds') || []), ...attrs.adminApprovedCubeIds])
      .save(null, { useMasterKey: true, context: { audit } })
  }
  const taskList = new TaskList(attrs)
  const audit = { fn: 'task-list-generate' }
  return taskList.save(null, { useMasterKey: true, context: { audit } })
}

async function processOrder (className, objectId) {
  const periodStart = '2023-04-01'
  const order = await $getOrFail(className, objectId)
  const contract = className === 'Contract' ? order : null
  const booking = className === 'Booking' ? order : null
  const disassembliesQuery = $query('Disassembly').equalTo('contract', contract).equalTo('booking', booking)
  // abort and clear lists if disassembly will not be done by RMV
  if (!order.get('disassembly')?.fromRMV) {
    return $query(Disassembly)
      .equalTo('contract', contract)
      .equalTo('booking', booking)
      .lessThan('status', 2) // planned
      .each(disassembly => disassembly.destroy({ useMasterKey: true }), { useMasterKey: true })
  }

  const plannedDisassemblies = {}
  for (const cubeId of order.get('cubeIds')) {
    const earlyCanceledAt = order.get('earlyCancellations')?.[cubeId]
    if (earlyCanceledAt === true) { continue }
    if (earlyCanceledAt) {
      const date = moment(earlyCanceledAt).add(1, 'day').format('YYYY-MM-DD')
      if (!plannedDisassemblies[date]) {
        plannedDisassemblies[date] = { type: 'early', cubeIds: [] }
      }
      plannedDisassemblies[date].cubeIds.push(cubeId)
      continue
    }
    if (!order.get('willExtend')) {
      // TODO: Test later ending cubes
      const cubeExtendedUntil = order.get('cubeExtensions')?.[cubeId]
      if (cubeExtendedUntil) {
        const date = moment(cubeExtendedUntil).add(1, 'day').format('YYYY-MM-DD')
        if (!plannedDisassemblies[date]) {
          plannedDisassemblies[date] = { type: 'late', cubeIds: [] }
        }
        plannedDisassemblies[date].cubeIds.push(cubeId)
        continue
      }
      const date = moment(order.get('endsAt')).add(1, 'day').format('YYYY-MM-DD')
      if (!plannedDisassemblies[date]) {
        plannedDisassemblies[date] = { type: 'end', cubeIds: [] }
      }
      plannedDisassemblies[date].cubeIds.push(cubeId)
    }
  }

  const uniqueDatePlaceKeys = {}
  for (const [date, { cubeIds }] of Object.entries(plannedDisassemblies)) {
    // remove dates before periodStart
    if (moment(date).isBefore(periodStart)) {
      delete plannedDisassemblies[date]
      continue
    }
    plannedDisassemblies[date].dueDate = moment(date).add(2, 'weeks').format('YYYY-MM-DD')
    // separate by placekey
    plannedDisassemblies[date].datePlaceCubes = await $query('Cube')
      .containedIn('objectId', cubeIds)
      .select(['ort', 'state'])
      .limit(cubeIds.length)
      .find({ useMasterKey: true })
      .then(cubes => cubes.reduce((acc, cube) => {
        const key = [cube.get('ort'), cube.get('state').id, date].join('_')
        uniqueDatePlaceKeys[key] = true
        if (!acc[key]) { acc[key] = [] }
        acc[key].push(cube.id)
        return acc
      }, {}))
  }

  // First check if we have task lists that have the same cubes in the some locations, but only the date has changed, to easily shift the dates
  // NOTE: not working because we disassembly remains with date
  // await $query(TaskList)
  //   .equalTo('type', 'disassembly')
  //   .matchesQuery('disassembly', disassembliesQuery)
  //   .select('date', 'ort', 'state', 'cubeIds')
  //   .eachBatch(async (batch) => {
  //     for (const taskList of batch) {
  //       for (const [date, { datePlaceCubes, dueDate }] of Object.entries(plannedDisassemblies)) {
  //         for (const [key, cubeIds] of Object.entries(datePlaceCubes)) {
  //           const [ort, stateId, date] = key.split('_')
  //           if (taskList.get('ort') === ort && taskList.get('state')?.id === stateId && taskList.get('date') !== date) {
  //             if (isEqual(sortBy(cubeIds), sortBy(taskList.get('cubeIds')))) {
  //               // this is the same list but date has changed
  //               consola.success('FOUND DATE CHANGE')
  //               const changes = $changes(taskList, { date, dueDate })
  //               taskList.set({ status: 0, date, dueDate })
  //               const audit = { fn: 'task-list-update-date', data: { changes } }
  //               await taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup: true } })
  //             }
  //           }
  //         }
  //       }
  //     }
  //   }, { useMasterKey: true })

  // Gather admin approved cubes in each area to carry the information if the date has changed, and apply to each list.
  // The list before save triggers will clear any non-listed cubes.
  // Todo: Carry the audits?
  const adminApprovedCubeIds = await $query(TaskList)
    .equalTo('type', 'disassembly')
    .matchesQuery('disassembly', disassembliesQuery)
    .notEqualTo('adminApprovedCubeIds', null)
    .notEqualTo('adminApprovedCubeIds', [])
    .distinct('adminApprovedCubeIds', { useMasterKey: true })
    .then(response => response.flat())

  const submissions = order.get('disassembly')?.submissions || {}

  // need a single source of truth for admin approved cube ids, statuses and managers and need to keep protocol
  let i = 0
  for (const [date, { type, dueDate, datePlaceCubes }] of Object.entries(plannedDisassemblies)) {
    const disassembly = await ensureDisassemblyExists(order, date, dueDate, type)

    for (const uniqueKey of Object.keys(datePlaceCubes)) {
      const [ort, stateId] = uniqueKey.split('_')
      const cubeIds = datePlaceCubes[uniqueKey]
      const state = $pointer('State', stateId)
      const taskList = await upsertTaskList({
        type: 'disassembly',
        ort,
        state,
        disassembly,
        cubeIds,
        date,
        dueDate,
        adminApprovedCubeIds
      })
      const submissionCubeIds = intersection(Object.keys(submissions), cubeIds)
      if (submissionCubeIds.length) {
        for (const submissionId of submissionCubeIds.map(id => submissions[id])) {
          const submission = await $getOrFail(DisassemblySubmission, submissionId)
          await submission.set({ taskList }).save(null, { useMasterKey: true })
        }
        const audit = { fn: 'disassembly-submission-update', data: { cubeIds: submissionCubeIds } }
        await taskList.save(null, { useMasterKey: true, context: { audit } })
      }
      i++
    }
  }

  // Remove all lists which no longer fit the criteria
  await $query(TaskList)
    .equalTo('type', 'disassembly')
    .matchesQuery('disassembly', disassembliesQuery)
    .eachBatch(async (lists) => {
      for (const list of lists) {
        const uniqueKey = [list.get('ort'), list.get('state').id, list.get('date')].join('_')
        if (!uniqueDatePlaceKeys[uniqueKey]) {
          await list.destroy({ useMasterKey: true })
        }
      }
    }, { useMasterKey: true })

  // Remove all disassemblies (parents) that are no longer planned (which removes lists within)
  // Note: this will fail if the disassembly has task lists that are "in progress"
  const ids = Object.keys(plannedDisassemblies).map(date => order.className + '-' + order.id + '-' + date)
  await $query(Disassembly)
    .startsWith('objectId', order.className + '-' + order.id)
    .notContainedIn('objectId', ids)
    .each((disassembly) => {
      consola.warn('Removing disassembly', disassembly)
      return disassembly.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
  consola.debug('ids', ids)
  consola.debug(plannedDisassemblies)

  return i
}

// Update booking or contract disassembly from RMV
Parse.Cloud.define('disassembly-order-update', async ({
  params: {
    className,
    id,
    fromRMV
  }, user
}) => {
  const order = await $query(className).get(id, { useMasterKey: true })
  const disassembly = order.get('disassembly') || {}
  const changes = $changes(disassembly, { fromRMV }, true)
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen') }
  // rename key
  changes.disassemblyFromRMV = changes.fromRMV
  delete changes.fromRMV
  disassembly.fromRMV = fromRMV
  order.set({ disassembly })
  if (!fromRMV) {
    if (!disassembly.statuses && !disassembly.submissions) {
      order.unset('disassembly')
    }
  }
  const audit = { user, fn: className.toLowerCase() + '-update', data: { changes } }
  return order.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('disassembly-order-sync', async ({ params: { className, id }, user }) => {
  return processOrder(className, id)
}, { requireUser: true })

module.exports = {
  processOrder
}
