const axios = require('axios')
const { intersection } = require('lodash')

const TaskList = Parse.Object.extend('TaskList')
const Disassembly = Parse.Object.extend('Disassembly')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')

Parse.Cloud.beforeSave(Disassembly, ({ object: disassembly }) => {
  if (disassembly.get('booking') && disassembly.get('contract')) {
    throw new Error('Disassembly cannot be tied to a booking and a contract simultaneously')
  }
  // make sure the id matches the booking / contract
  const [className, objectId] = disassembly.id.split('-')
  if (disassembly.get(className.toLowerCase()).id !== objectId) {
    throw new Error('Disassembly key does not match booking / contract')
  }

  !disassembly.get('status') && disassembly.set('status', 0)
  disassembly.unset('order')
})

Parse.Cloud.afterSave(Disassembly, ({ object: disassembly, context: { audit } }) => { $audit(disassembly, audit) })

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
  }
})

Parse.Cloud.beforeDelete(Disassembly, async ({ object: disassembly }) => {
  // TODO: Allow deleting in a different way
  const remaining = await $query(TaskList)
    .equalTo('disassembly', disassembly)
    .notEqualTo('status', 0)
    .count({ useMasterKey: true })
  if (remaining) {
    throw new Error('Cannot delete disassembly with in progress tasks')
  }
  await $query(TaskList)
    .equalTo('disassembly', disassembly)
    .equalTo('status', 0)
    .each(list => list.destroy({ useMasterKey: true }), { useMasterKey: true })
})

async function ensureDisassemblyExists (order) {
  const disassemblyKey = order.className + '-' + order.id
  const exists = await $query(Disassembly).equalTo('objectId', disassemblyKey).first({ useMasterKey: true })
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
  // Temporary start may 1
  const periodStart = '2023-04-20'
  const periodEnd = '2023-08-31'
  // const periodStart = moment(await $today()).startOf('month').subtract(1, 'week').format('YYYY-MM-DD')
  // const periodEnd = moment(await $today()).endOf('month').add(2, 'months').format('YYYY-MM-DD')
  const order = await $getOrFail(className, objectId)

  // abort if disassembly will not be done by RMV, or if done outside of WaWi
  if (!order.get('disassembly') || order.get('disassemblySkip')) {
    // clear all lists which are still in draft status
    const disassembly = await $query(Disassembly)
      .equalTo('objectId', [order.className, order.id].join('-'))
      .first({ useMasterKey: true })
    disassembly && await disassembly.destroy({ useMasterKey: true })
    return
  }

  const { cubeIds, earlyCancellations, endsAt, autoExtendsAt, canceledAt } = order.attributes

  // get ending at dates of all cubes
  const cubeEndDates = {}
  for (const cubeId of cubeIds) {
    const earlyCanceledAt = earlyCancellations?.[cubeId]
    if (earlyCanceledAt === true) {
      continue
    }
    if (!autoExtendsAt || canceledAt) {
      cubeEndDates[cubeId] = endsAt
    }
    if (earlyCanceledAt) {
      cubeEndDates[cubeId] = earlyCanceledAt
    }
    // TODO: Add later ending cubes
  }

  const keys = {}
  const cubeLocations = await $query('Cube')
    .containedIn('objectId', Object.keys(cubeEndDates))
    .select(['ort', 'state'])
    .limit(Object.keys(cubeEndDates).length)
    .find({ useMasterKey: true })
    .then(cubes => cubes.reduce((acc, cube) => {
      acc[cube.id] = { ort: cube.get('ort'), stateId: cube.get('state').id }
      return acc
    }, {}))
  for (const cubeId of Object.keys(cubeEndDates)) {
    const endDate = cubeEndDates[cubeId]
    const disassemblyStartDate = moment(endDate).add(1, 'day')
    // remove dates between periodStart and periodEnd
    if (!moment(disassemblyStartDate).isBetween(periodStart, periodEnd, undefined, '[]')) {
      continue
    }
    // accumulate all cubes that have to be disassembled within the period, dividing into dates
    const uniqueKey = [cubeLocations[cubeId].ort, cubeLocations[cubeId].stateId, disassemblyStartDate.format('YYYY-MM-DD')].join('_')
    if (!(uniqueKey in keys)) {
      keys[uniqueKey] = []
    }
    keys[uniqueKey].push(cubeId)
  }

  // Make sure Disassembly is created if task lists exist
  const disassembly = await ensureDisassemblyExists(order)

  // gather admin approved cubes in each area to carry the information if the date has changed, and apply to each list. The list before save triggers will clear any non-listed cubes.
  const adminApprovedCubeIds = await $query(TaskList)
    .equalTo('type', 'disassembly')
    .equalTo('disassembly', disassembly)
    .notEqualTo('adminApprovedCubeIds', null)
    .notEqualTo('adminApprovedCubeIds', [])
    .distinct('adminApprovedCubeIds', { useMasterKey: true })
    .then(response => response.flat())

  // Remove all lists which no longer fit the criteria, while checking to see if disassembly has started
  const submissionAdjustments = {}
  await $query(TaskList)
    .equalTo('disassembly', disassembly)
    .eachBatch(async (lists) => {
      for (const list of lists) {
        // if list has a submission carry it to new list
        const statuses = list.get('statuses') || {}
        if (Object.keys(statuses).length) {
          await $query(DisassemblySubmission).equalTo('taskList', list).eachBatch((submissions) => {
            for (const submission of submissions) {
              submissionAdjustments[submission.get('cube').id] = submission
            }
          }, { useMasterKey: true })
        }
        const uniqueKey = [list.get('ort'), list.get('state').id, list.get('date')].join('_')
        if (!keys[uniqueKey]) {
          await list.destroy({ useMasterKey: true })
        }
      }
    }, { useMasterKey: true })

  let i = 0
  for (const uniqueKey in keys) {
    const [ort, stateId, date] = uniqueKey.split('_')
    const cubeIds = keys[uniqueKey]
    const state = $pointer('State', stateId)
    const taskList = await upsertTaskList({
      type: 'disassembly',
      ort,
      state,
      disassembly,
      cubeIds,
      date,
      dueDate: moment(date).add(2, 'weeks').format('YYYY-MM-DD'),
      adminApprovedCubeIds
    })
    const submissionCubeIds = intersection(Object.keys(submissionAdjustments), cubeIds)
    if (submissionCubeIds.length) {
      for (const submission of submissionCubeIds.map(id => submissionAdjustments[id])) {
        await submission.set({ taskList }).save(null, { useMasterKey: true })
      }
      const audit = { fn: 'disassembly-submission-update', data: { cubeIds: submissionCubeIds } }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
    }
    i++
  }

  // if there are no task lists remaining, remove the disassembly
  if (!await $query(TaskList).equalTo('disassembly', disassembly).count({ useMasterKey: true })) {
    await disassembly.destroy({ useMasterKey: true })
  }
  return i
}

// Update booking or contract disassembly from RMV
Parse.Cloud.define('disassembly-order-update', async ({
  params: {
    className,
    id,
    disassembly,
    disassemblySkip
  }, user
}) => {
  const bc = await $query(className).get(id, { useMasterKey: true })
  const changes = $changes(bc, { disassembly, disassemblySkip })
  disassembly ? bc.set({ disassembly }) : bc.unset('disassembly')
  disassemblySkip ? bc.set({ disassemblySkip }) : bc.unset('disassemblySkip')
  const audit = { user, fn: className.toLowerCase() + '-update', data: { changes } }
  return bc.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('disassembly-tasks-regenerate', async ({
  params: {
    className,
    id
  }, user
}) => {
  const bc = await $query(className).get(id, { useMasterKey: true })
  await processOrder(className, id)
  const audit = { user, fn: 'regenerate-order-disassemblies' }
  return bc.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

module.exports = {
  processOrder
}
