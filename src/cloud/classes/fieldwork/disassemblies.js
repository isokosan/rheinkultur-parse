const { difference } = require('lodash')

async function upsertTaskList (attrs) {
  // first check if a departure list with the same
  // uniqueTogether = { type, booking, contract, ort, state, date }
  const exists = await $query('TaskList')
    .equalTo('type', 'disassembly')
    .equalTo('booking', attrs.booking)
    .equalTo('contract', attrs.contract)
    .equalTo('ort', attrs.ort)
    .equalTo('state', attrs.state)
    .equalTo('date', attrs.date)
    .first({ useMasterKey: true })

  // remove cubeIds from other disassembly lists if it now appears here
  const otherLists = await $query('TaskList')
    .equalTo('type', 'disassembly')
    .equalTo('booking', attrs.booking)
    .equalTo('contract', attrs.contract)
    .containedIn('cubeIds', attrs.cubeIds)
  exists && otherLists.notEqualTo('objectId', exists.id)
  await otherLists.each(async (list) => {
    // TODO: abbau check
    const cubeIds = difference(list.get('cubeIds'), attrs.cubeIds)
    const cubeChanges = $cubeChanges(list, cubeIds)
    if (cubeChanges) {
      const audit = { fn: 'task-list-update', data: { cubeChanges } }
      await list.set({ cubeIds }).save(null, { useMasterKey: true, context: { audit } })
    }
  }, { useMasterKey: true })

  if (exists) {
    const cubeChanges = $cubeChanges(exists, attrs.cubeIds)
    if (!cubeChanges) { return exists }
    const audit = { fn: 'task-list-update', data: { cubeChanges } }
    return exists.set('cubeIds', attrs.cubeIds).save(null, { useMasterKey: true, context: { audit } })
  }
  const TaskList = Parse.Object.extend('TaskList')
  const taskList = new TaskList(attrs)
  const audit = { fn: 'task-list-generate' }
  return taskList.save(null, { useMasterKey: true, context: { audit } })
}

async function processOrder (className, objectId) {
  const periodStart = moment(await $today()).startOf('month').subtract(1, 'week').format('YYYY-MM-DD')
  const periodEnd = moment(await $today()).endOf('month').add(2, 'months').format('YYYY-MM-DD')
  const order = await $getOrFail(className, objectId)

  // abort if disassembly will not be done by RMV, or if done outside of WaWi
  if (!order.get('disassembly')) { return }
  if (order.get('markedDisassembled') === true) { return }

  const { cubeIds, markedDisassembled, earlyCancellations, endsAt, autoExtendsAt, canceledAt } = order.attributes

  // get ending at dates of all cubes
  const cubeEndDates = {}
  for (const cubeId of cubeIds) {
    if (markedDisassembled?.[cubeId]) {
      continue
    }
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
  let i = 0
  for (const uniqueKey in keys) {
    const [ort, stateId, date] = uniqueKey.split('_')
    const cubeIds = keys[uniqueKey]
    consola.info(uniqueKey, cubeIds.length)
    const state = $pointer('State', stateId)
    await upsertTaskList({
      type: 'disassembly',
      ort,
      state,
      contract: className === 'Contract' ? order : null,
      booking: className === 'Booking' ? order : null,
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
    disassembly
  }, user
}) => {
  const bc = await $query(className).get(id, { useMasterKey: true })
  const changes = $changes(bc, { disassembly })
  bc.set({ disassembly })
  const audit = { user, fn: className.toLowerCase() + '-update', data: { changes } }
  return bc.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('disassembly-mark-done', async ({
  params: {
    className,
    id,
    markedDisassembled
  }, user
}) => {
  const bc = await $query(className).get(id, { useMasterKey: true })
  bc.set({ markedDisassembled })
  return bc.save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('disassembly-tasks-regenerate', async ({
  params: {
    className,
    id
  }, user
}) => {
  const bc = await $query(className).get(id, { useMasterKey: true })
  await processOrder(className, id)
  const audit = { user, fn: className.toLowerCase() + '-regenerate-disassembly-tasks' }
  return bc.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

module.exports = {
  upsertTaskList,
  processOrder
}
