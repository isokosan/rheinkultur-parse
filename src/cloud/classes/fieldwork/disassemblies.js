// const Disassembly = Parse.Object.extend('Disassembly')
const TaskList = Parse.Object.extend('TaskList')

// Parse.Cloud.beforeSave(Disassembly, ({ object: disassembly }) => {
//   !disassembly.get('status') && disassembly.set('status', 0)
// })

// Parse.Cloud.afterSave(Disassembly, ({ object: Disassembly, context: { audit } }) => { $audit(disassembly, audit) })

// Parse.Cloud.beforeFind(Disassembly, ({ query }) => {
//   query.include(['contract', 'booking'])
// })

// Parse.Cloud.afterFind(Disassembly, async ({ query, objects: disassemblies }) => {
//   // disassembly tasks
//   const pipeline = [
//     { $match: { _p_disassembly: { $in: disassemblies.map(c => 'Disassembly$' + c.id) } } },
//     { $group: { _id: '$disassembly', taskListCount: { $sum: 1 }, cubeCount: { $sum: '$cubeCount' } } }
//   ]
//   const counts = await $query('TaskList').aggregate(pipeline)
//     .then(response => response.reduce((acc, { objectId, taskListCount, cubeCount }) => ({ ...acc, [objectId]: { taskListCount, cubeCount } }), {}))
//   for (const disassembly of disassemblies) {
//     disassembly.set(counts[disassembly.id])
//   }
// })

async function upsertTaskList (attrs) {
  // get admin approved cubes in each area to carry the information if the date has changed, and apply to each list. The list before save triggers will clear any non-listed cubes.
  const adminApprovedCubeIds = await $query('TaskList')
    .equalTo('type', 'disassembly')
    .equalTo('booking', attrs.booking)
    .equalTo('contract', attrs.contract)
    .equalTo('ort', attrs.ort)
    .equalTo('state', attrs.state)
    .notEqualTo('adminApprovedCubeIds', null)
    .notEqualTo('adminApprovedCubeIds', [])
    .distinct('adminApprovedCubeIds', { useMasterKey: true })
    .then(response => response.flat())

  // first check if a departure list with the same unique attrs exists
  // uniqueTogether = { type, booking, contract, ort, state, date }
  const existing = await $query('TaskList')
    .equalTo('type', 'disassembly')
    .equalTo('booking', attrs.booking)
    .equalTo('contract', attrs.contract)
    .equalTo('ort', attrs.ort)
    .equalTo('state', attrs.state)
    .equalTo('date', attrs.date)
    .find({ useMasterKey: true })
  const [exists, ...duplicates] = existing
  duplicates.length && await Promise.all(duplicates.map((duplicate) => {
    consola.warn('Removing duplicate disassembly', duplicate.attributes)
    return duplicate.destroy({ useMasterKey: true })
  }))
  if (exists) {
    const cubeChanges = $cubeChanges(exists, attrs.cubeIds)
    if (!cubeChanges) { return exists }
    const audit = { fn: 'task-list-update', data: { cubeChanges } }
    return exists
      .set('cubeIds', attrs.cubeIds)
      .set('adminApprovedCubeIds', adminApprovedCubeIds)
      .save(null, { useMasterKey: true, context: { audit } })
  }
  const TaskList = Parse.Object.extend('TaskList')
  const taskList = new TaskList({ ...attrs, adminApprovedCubeIds })
  const audit = { fn: 'task-list-generate' }
  return taskList.save(null, { useMasterKey: true, context: { audit } })
}

async function processOrder (className, objectId) {
  // Temporary start may 1
  const periodStart = '2023-05-01'
  const periodEnd = '2023-08-31'
  // const periodStart = moment(await $today()).startOf('month').subtract(1, 'week').format('YYYY-MM-DD')
  // const periodEnd = moment(await $today()).endOf('month').add(2, 'months').format('YYYY-MM-DD')
  const order = await $getOrFail(className, objectId)

  // abort if disassembly will not be done by RMV, or if done outside of WaWi
  if (!order.get('disassembly') || order.get('disassemblySkip')) {
    // clear all lists which are still in draft status
    await $query(TaskList)
      .equalTo(className.toLowerCase(), order)
      .equalTo('status', 0)
      .each(list => list.destroy({ useMasterKey: true }), { useMasterKey: true })
    return
    // $query(Disassembly)
    //   .equalTo(className.toLowerCase(), order)
    //   .equalTo('status', 0)
    //   .each(disassembly => disassembly.destroy({ useMasterKey: true }), { useMasterKey: true })
  }

  // const disassembly = await $query(Disassembly)
  //   .equalTo(className.toLowerCase(), order)
  //   .first({ useMasterKey: true }) || new Disassembly({ [className.toLowerCase()]: order })
  // await disassembly.save(null, { useMasterKey: true })

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

  // Remove all lists which no longer fit the criteria
  await $query(TaskList)
    .equalTo(className.toLowerCase(), order)
    .eachBatch(async (lists) => {
      for (const list of lists) {
        const uniqueKey = [list.get('ort'), list.get('state').id, list.get('date')].join('_')
        if (!keys[uniqueKey]) {
          consola.warn('key removed', list)
          await list.destroy({ useMasterKey: true })
        }
      }
    }, { useMasterKey: true })

  let i = 0
  for (const uniqueKey in keys) {
    const [ort, stateId, date] = uniqueKey.split('_')
    const cubeIds = keys[uniqueKey]
    const state = $pointer('State', stateId)
    await upsertTaskList({
      type: 'disassembly',
      ort,
      state,
      contract: className === 'Contract' ? order : null,
      booking: className === 'Booking' ? order : null,
      // disassembly,
      cubeIds,
      date,
      dueDate: moment(date).add(2, 'weeks').format('YYYY-MM-DD')
    })
    i++
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
  upsertTaskList,
  processOrder
}
