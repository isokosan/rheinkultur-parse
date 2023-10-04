const axios = require('axios')
const { intersection } = require('lodash')

const Disassembly = Parse.Object.extend('Disassembly')
const TaskList = Parse.Object.extend('TaskList')
const DisassemblySubmission = Parse.Object.extend('DisassemblySubmission')
const { getStatusAndCounts } = require('./task-lists')

const DISCARD_BEFORE = moment('2023-07-01').subtract(1, 'day').format('YYYY-MM-DD')

const getDueDate = date => moment(date).add(2, 'weeks').format('YYYY-MM-DD')

Parse.Cloud.beforeSave(Disassembly, async ({ object: disassembly, context: { syncStatus } }) => {
  if (disassembly.get('booking') && disassembly.get('contract')) {
    throw new Error('Disassembly cannot be tied to a booking and a contract simultaneously')
  }
  // make sure the id matches the booking / contract
  const [className, objectId] = disassembly.id.split('-')
  if (disassembly.get(className.toLowerCase()).id !== objectId) {
    throw new Error('Disassembly key does not match booking / contract')
  }

  !disassembly.get('status') && disassembly.set('status', 1)
  !disassembly.get('dueDate') && disassembly.set('dueDate', getDueDate(disassembly.get('date')))
  disassembly.unset('order')
  if (disassembly.isNew()) { return }

  if (syncStatus || !disassembly.get('counts')) {
    const { status, counts } = await getStatusAndCounts({ disassembly })
    // TODO: if changing add audit
    disassembly.set({ status, counts })
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

async function checkActiveTaskListsExists ({ order, className, disassembly }) {
  if ((!order || !className) && !disassembly) {
    throw new Error('Either order and className or disassembly must be provided')
  }
  const query = $query(TaskList)
  if (order) {
    const contract = className === 'Contract' ? order : null
    const booking = className === 'Booking' ? order : null
    query.matchesQuery('disassembly', $query(Disassembly).equalTo('contract', contract).equalTo('booking', booking))
  }
  disassembly && query.equalTo('disassembly', disassembly)
  // TODO: Update check here and go over notifications
  if (await query.greaterThanOrEqualTo('status', 1).count({ useMasterKey: true })) {
    throw new Error('Demontage mit geplante Listen kann nicht gelöscht werden.')
  }
  // const activeLists = await query.greaterThanOrEqualTo('status', 1).find({ useMasterKey: true })
  // if (activeLists.length) {
  //   throw new Error('Cannot delete disassembly with submitted tasks.')
  // }
  // if (submissions) {
  //   // Lists with submissions from scouts
  //   // If there are any submissions from scouts already in this list, do not allow deleting.
  //   throw new Error('Cannot delete disassembly with submitted tasks.')
  // }
  // If there is no submissions yet, but the list was Ernannt oder Beauftragt - then we notify & delete.
  // Send a notification to all the scouts, and manager of the list, and all feldarbeit-managers
  // Eine (Demontage/Kontrol/Scouting) liste in Solingen mit # CityCubes wurde gelöscht. (Add the cube and standorte in the notification to show it in a popup when clicked.)
}

// TODO: Make sure status of Disassembly is saved and updated?
Parse.Cloud.beforeDelete(Disassembly, async ({ object: disassembly }) => {
  await checkActiveTaskListsExists({ disassembly })
  await $query(TaskList)
    .equalTo('disassembly', disassembly)
    .lessThan('status', 1)
    .each(list => list.destroy({ useMasterKey: true }), { useMasterKey: true })
})

async function ensureDisassemblyExists (order, date, dueDate, type) {
  const disassemblyKey = order.className + '-' + order.id + '-' + date + '-' + type
  !dueDate && (dueDate = getDueDate(date))
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

// Update booking or contract disassembly from RMV
Parse.Cloud.define('disassembly-order-update', async ({
  params: {
    className,
    id,
    fromRMV
  }, user
}) => {
  const order = await $query(className).get(id, { useMasterKey: true })
  !fromRMV && await checkActiveTaskListsExists({ order, className })
  const disassembly = order.get('disassembly') || {}
  const changes = $changes(disassembly, { fromRMV }, true)
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen') }
  // rename audit key
  changes.disassemblyFromRMV = [Boolean(changes.fromRMV[0]), Boolean(changes.fromRMV[1])]
  delete changes.fromRMV
  disassembly.fromRMV = fromRMV
  order.set({ disassembly })
  const audit = { user, fn: className.toLowerCase() + '-update', data: { changes } }
  if (!fromRMV) {
    if (!disassembly.statuses && !disassembly.submissions) {
      order.unset('disassembly')
    }
  }
  await order.save(null, { useMasterKey: true, context: { audit } })
  await Parse.Cloud.run('disassembly-order-sync', { className, id }, { useMasterKey: true })
}, $internOrAdmin)

Parse.Cloud.define('disassembly-order-sync', async ({ params: { className, id: orderId, forceSince }, user }) => {
  const discardBefore = forceSince || DISCARD_BEFORE

  const sync = []
  const today = await $today()
  const order = await $getOrFail(className, orderId)
  let orderEndDate = order.get('willExtend') ? null : order.get('endsAt')
  if (orderEndDate && orderEndDate < discardBefore) {
    orderEndDate = null
  }
  const contract = className === 'Contract' ? order : null
  const booking = className === 'Booking' ? order : null
  const getDisassembliesQuery = () => $query(Disassembly).equalTo('contract', contract).equalTo('booking', booking)

  // abort and clear lists if disassembly will not be done by RMV
  if (!order.get('disassembly')?.fromRMV) {
    await getDisassembliesQuery().each(disassembly => disassembly.destroy({ useMasterKey: true }), { useMasterKey: true })
    sync.push({ type: 'all', action: 'remove' })
    const audit = { fn: 'disassembly-sync', data: { sync } }
    await order.save(null, { useMasterKey: true, context: { audit } })
    return sync
  }

  const getDisassemblyStartDate = endDate => endDate && endDate >= discardBefore ? moment(endDate).add(1, 'day').format('YYYY-MM-DD') : null

  async function updateTaskListDates (taskList, date, dueDate, type) {
    const disassembly = await ensureDisassemblyExists(order, date, dueDate, type)
    const changes = $changes(taskList, { date, dueDate })
    if (!$cleanDict(changes)) { return }
    let locationCleanup
    if ([2, 3].includes(taskList.get('status')) && date > today) {
      changes.status = [taskList.get('status', 1)]
      taskList.set('status', 1)
      locationCleanup = true
    }
    const audit = { fn: 'task-list-update', data: { changes } }
    taskList.set({ disassembly, date, dueDate })
    await taskList.save(null, { useMasterKey: true, context: { audit, locationCleanup } })
  }

  async function moveCubesFromTo (from, to, cubeIds) {
    const toCubeIds = [...to.get('cubeIds'), ...cubeIds]
    const cubeChanges = $cubeChanges(to, toCubeIds)
    if (cubeChanges) {
      const audit = { fn: 'task-list-update', data: { cubeChanges } }
      const adminApprovedCubeIds = [...(from.get('adminApprovedCubeIds') || []), ...(to.get('adminApprovedCubeIds') || [])]
      to.set({ cubeIds: toCubeIds, adminApprovedCubeIds })
      await to.save(null, { useMasterKey: true, context: { audit } })
      consola.success('to saved with', audit, to.id)
    }
    // Make sure submissions are moved
    const submissions = order.get('disassembly')?.submissions || {}
    const submissionCubeIds = intersection(Object.keys(submissions), cubeIds)
    const updatedIds = []
    if (submissionCubeIds.length) {
      for (const submissionId of submissionCubeIds.map(id => submissions[id])) {
        try {
          const submission = await $getOrFail(DisassemblySubmission, submissionId)
          if (submission.get('taskList').id !== to.id) {
            await submission.set({ taskList: to }).save(null, { useMasterKey: true })
            updatedIds.push(submissionId)
          }
        } catch (error) {
          consola.error('disassembly sync error', error)
        }
      }
      const audit = { fn: 'disassembly-submission-update', data: { cubeIds: submissionCubeIds } }
      await to.save(null, { useMasterKey: true, context: { audit } })
    }

    const fromRemainingCubes = from.get('cubeIds').filter(id => !to.get('cubeIds').includes(id))
    if (!fromRemainingCubes.length) {
      const notifyRemovedWithAttributes = from.get('status')
        ? { orderClass: order.className, orderId: order.id, orderNo: order.get('no') }
        : false
      return from.destroy({ useMasterKey: true, context: { notifyRemovedWithAttributes } })
    }
    const fromCubeChanges = $cubeChanges(from, fromRemainingCubes)
    if (!fromCubeChanges) { return }
    from.set('cubeIds', fromRemainingCubes)
    const fromAudit = { fn: 'task-list-update', data: { cubeChanges: fromCubeChanges } }
    return from.save(null, { useMasterKey: true, context: { audit: fromAudit } })
  }

  const extraCubeIds = ['earlyCancellations', 'cubeExtensions'].map(key => Object.keys((order.get(key) || {}))).flat()

  // first get the main disassembly, and check if the date is matching the current main end date
  const mainDisassembly = await getDisassembliesQuery().equalTo('type', 'main').first({ useMasterKey: true })
  if (mainDisassembly) {
    const date = getDisassemblyStartDate(orderEndDate)
    const dueDate = getDueDate(date)
    if (mainDisassembly.get('date') !== date) {
      if (orderEndDate) {
        await $query(TaskList).equalTo('disassembly', mainDisassembly).eachBatch(async (taskLists) => {
          for (const taskList of taskLists) {
            await updateTaskListDates(taskList, date, dueDate, 'main')
          }
        }, { useMasterKey: true })
        sync.push({ type: 'main', action: 'update-date', date: [mainDisassembly.get('date'), date] })
      } else {
        sync.push({ type: 'main', action: 'remove', date: mainDisassembly.get('date') })
      }
      if (mainDisassembly.get('date') >= DISCARD_BEFORE) {
        await mainDisassembly.destroy({ useMasterKey: true })
      }
    }
  } else if (orderEndDate) {
    const date = getDisassemblyStartDate(orderEndDate)
    const dueDate = getDueDate(date)
    const newMainAssembly = await ensureDisassemblyExists(order, date, dueDate, 'main')
    // get all cubes that were not early canceled or have extensions
    const mainCubeIds = order.get('cubeIds').filter(cubeId => !extraCubeIds.includes(cubeId))
    const mainLists = await $query('Cube')
      .containedIn('objectId', mainCubeIds)
      .select('pk')
      .limit(mainCubeIds.length)
      .find({ useMasterKey: true })
      .then(cubes => cubes.reduce((acc, cube) => {
        const pk = cube.get('pk')
        if (!acc[pk]) { acc[pk] = [] }
        acc[pk].push(cube.id)
        return acc
      }, {}))
    for (const [pk, cubeIds] of Object.entries(mainLists)) {
      const { ort, state } = $parsePk(pk)
      const taskList = new TaskList({
        type: 'disassembly',
        disassembly: newMainAssembly,
        status: 0.1, // generate as planned
        ort,
        state,
        cubeIds,
        date,
        dueDate
      })
      const audit = { fn: 'task-list-generate' }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
    }
    sync.push({ type: 'main', action: 'create', date })
  }

  function getCubeEndDate (cubeId) {
    const earlyCanceledAt = order.get('earlyCancellations')?.[cubeId]
    if (earlyCanceledAt === true) { return null }
    if (earlyCanceledAt) { return earlyCanceledAt }
    if (orderEndDate) {
      const cubeExtension = order.get('cubeExtensions')?.[cubeId]
      return cubeExtension
        ? moment(orderEndDate).add(cubeExtension, 'days').format('YYYY-MM-DD')
        : orderEndDate
    }
    return null
  }

  function getCubeDisassemblyDate (cubeId) {
    const endDate = getCubeEndDate(cubeId)
    return getDisassemblyStartDate(endDate)
  }

  // Get a list of all locations with the end date. null if not ending.
  // Make sure that previously 'extra' listed cube disassemblies are included for removal
  await $query(TaskList)
    .matchesQuery('disassembly', getDisassembliesQuery().equalTo('type', 'extra'))
    .select('cubeIds')
    .eachBatch((lists) => {
      for (const list of lists) {
        const cubeIds = list.get('cubeIds')
        for (const cubeId of cubeIds) {
          if (!extraCubeIds.includes(cubeId)) {
            extraCubeIds.push(cubeId)
          }
        }
      }
    }, { useMasterKey: true })

  const targetDates = await $query('Cube')
    .containedIn('objectId', extraCubeIds)
    .select('pk')
    .limit(extraCubeIds.length)
    .find({ useMasterKey: true })
    .then(cubes => cubes.reduce((acc, cube) => {
      const pk = cube.get('pk')
      if (!acc[pk]) { acc[pk] = {} }
      acc[pk][cube.id] = getCubeDisassemblyDate(cube.id)
      return acc
    }, {}))

  // Get all current list and dates per cube
  const CURRENT = {}
  const EXISTING_LISTS = {}
  await $query(TaskList)
    .equalTo('type', 'disassembly')
    .matchesQuery('disassembly', getDisassembliesQuery())
    .select(['cubeIds', 'date', 'pk'])
    .eachBatch((lists) => {
      for (const list of lists) {
        const pk = list.get('pk')
        if (!EXISTING_LISTS[pk]) { EXISTING_LISTS[pk] = {} }
        EXISTING_LISTS[pk][list.get('date')] = list
        if (!CURRENT[pk]) { CURRENT[pk] = {} }
        for (const cubeId of list.get('cubeIds')) {
          CURRENT[pk][cubeId] = { date: list.get('date'), list }
        }
      }
    }, { useMasterKey: true })

  // Process each place key for operations
  for (const pk of Object.keys(targetDates)) {
    const ops = { create: {}, move: {}, remove: {} }
    // Accumulate change operations in a new location
    for (const cubeId of Object.keys(targetDates[pk])) {
      const targetDate = targetDates[pk][cubeId] || undefined
      const { date: currentDate, list: currentList } = CURRENT[pk]?.[cubeId] || {}
      if (targetDate === currentDate) { continue }
      if (!targetDate && currentDate) {
        !ops.remove[currentList.id] && (ops.remove[currentList.id] = [])
        ops.remove[currentList.id].push(cubeId)
        continue
      }
      if (targetDate) {
        if (currentDate) {
          !ops.move[currentList.id] && (ops.move[currentList.id] = {})
          ops.move[currentList.id][cubeId] = targetDate
          continue
        }
        !ops.create[targetDate] && (ops.create[targetDate] = [])
        ops.create[targetDate].push(cubeId)
      }
    }

    // Carry out operations
    !Object.values(ops).every(op => Object.keys(op).length === 0) && consola.debug('carrying out changes in', pk, ops)
    for (const [date, cubeIds] of Object.entries(ops.create)) {
      const dueDate = getDueDate(date)
      const disassembly = await ensureDisassemblyExists(order, date, dueDate, 'extra')
      const { state, ort } = $parsePk(pk)
      const taskList = new TaskList({
        type: 'disassembly',
        disassembly,
        status: 0.1,
        ort,
        state,
        cubeIds,
        date,
        dueDate
      })
      const audit = { fn: 'task-list-generate' }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
      sync.push({ pk, type: 'extra', cubeIds, action: 'create', date })
    }
    for (const [listId, movements] of Object.entries(ops.move)) {
      const taskList = await $getOrFail(TaskList, listId)
      const cubeIds = Object.keys(movements)
      const dates = [...new Set(Object.values(movements))]
      // if all cubes will be moved, and to the same date
      if (cubeIds.length === taskList.get('cubeIds').length && dates.length === 1) {
        const moveDate = taskList.get('date')
        // check if there is an existing list with the same date
        const existingList = EXISTING_LISTS[pk]?.[dates[0]]
        if (existingList) {
          await existingList.fetch({ useMasterKey: true })
          await moveCubesFromTo(taskList, existingList, cubeIds)
          sync.push({ pk, type: 'extra', cubeIds, action: 'move', date: [moveDate, dates[0]], fn: 'move-cubes-from-to', from: taskList.id, to: existingList.id })
          continue
        }
        // move this list to the new date otherwise
        const date = dates[0]
        const dueDate = getDueDate(date)
        await updateTaskListDates(taskList, date, dueDate, 'extra')
        sync.push({ pk, type: 'extra', cubeIds, action: 'move', date: [moveDate, date], fn: 'update-task-list-dates', list: taskList.id })
        continue
      }
      // if some cubes will be remaining in this list, we will not touch it and only move the necessary ones
      for (const date of dates) {
        const dateCubes = cubeIds.filter(cubeId => movements[cubeId] === date)
        // check if there is an existing list with the same date
        const existingList = EXISTING_LISTS[pk]?.[date]
        if (existingList) {
          await existingList.fetch({ useMasterKey: true })
          await moveCubesFromTo(taskList, existingList, cubeIds)
          sync.push({ pk, type: 'extra', cubeIds: dateCubes, action: 'move', date: [taskList.get('date'), existingList.get('date')], fn: 'move-cubes-from-to', from: taskList.id, to: existingList.id })
          continue
        }
        // otherwise clone this list
        const dueDate = getDueDate(date)
        const disassembly = await ensureDisassemblyExists(order, date, dueDate, 'extra')
        const { state, ort } = $parsePk(pk)
        const newTaskList = new TaskList({
          type: 'disassembly',
          disassembly,
          status: taskList.get('status'),
          ort,
          state,
          date,
          manager: taskList.get('manager'),
          scouts: taskList.get('scouts'),
          dueDate
        })
        const audit = { fn: 'task-list-generate' }
        await newTaskList.save(null, { useMasterKey: true, context: { audit } })
        await moveCubesFromTo(taskList, newTaskList, dateCubes)
        sync.push({ pk, type: 'extra', cubeIds: dateCubes, action: 'move', date: [taskList.get('date'), date], fn: 'move-cubes-from-to', from: taskList.id, to: newTaskList.id })
      }
    }
    for (const [listId, removeCubeIds] of Object.entries(ops.remove)) {
      const taskList = await $getOrFail(TaskList, listId)
      // if all cubes will be moved, and to the same date
      if (removeCubeIds.length === taskList.get('cubeIds').length) {
        const notifyRemovedWithAttributes = taskList.get('status')
          ? { orderClass: order.className, orderId: order.id, orderNo: order.get('no') }
          : false
        await taskList.destroy({ useMasterKey: true, context: { notifyRemovedWithAttributes } })
        sync.push({ pk, action: 'remove', cubeIds: removeCubeIds, date: taskList.get('date') })
        continue
      }
      // if some cubes will be remaining in this list, we will not touch it and only move the necessary ones
      const remainingCubeIds = taskList.get('cubeIds').filter(cubeId => !removeCubeIds.includes(cubeId))
      const cubeChanges = $cubeChanges(taskList, remainingCubeIds)
      if (!cubeChanges) { continue }
      taskList.set('cubeIds', remainingCubeIds)
      const audit = { fn: 'task-list-update', data: { cubeChanges } }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
      sync.push({ pk, action: 'remove', cubeIds: removeCubeIds, date: taskList.get('date') })
    }
  }

  // remove disassemblies that do not have task lists anymore
  await getDisassembliesQuery().eachBatch(async (disassemblies) => {
    for (const disassembly of disassemblies) {
      if (!await $query(TaskList).equalTo('disassembly', disassembly).count({ useMasterKey: true })) {
        consola.debug('removing empty disassemblies')
        await disassembly.destroy({ useMasterKey: true })
      }
    }
  }, { useMasterKey: true })

  if (sync.length) {
    const audit = { fn: 'disassembly-sync', data: { sync } }
    await order.save(null, { useMasterKey: true, context: { audit } })
    return sync
  }
}, $fieldworkManager)
