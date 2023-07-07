const { isEqual, omit } = require('lodash')
const { round2, round5, parseAsDigitString } = require('./utils')
const getNewNo = async function (prefix, className, field, digits) {
  const last = await $query(className)
    .descending(field)
    .startsWith(field, prefix)
    .select([field])
    .first({ useMasterKey: true })
    .then(obj => obj?.toJSON())
  if (last) {
    const lastNo = parseInt(last[field].split(prefix)[1])
    if (lastNo) {
      return prefix + parseAsDigitString(lastNo + 1, digits)
    }
  }
  return prefix + parseAsDigitString(1, digits)
}

const getTaxRateOnDate = date => moment(date).isBetween('2020-07-01', '2020-12-31', undefined, '[]')
  ? 16
  : 19

const getTaxRatePercentage = (allowTaxFreeInvoices, date) => allowTaxFreeInvoices
  ? 0
  : getTaxRateOnDate(date)

function getDocumentTotals (allowTaxFreeInvoices, lineItems, date) {
  let netTotal = 0
  for (const item of lineItems || []) {
    netTotal = round2(netTotal + item.price)
  }
  const taxRate = getTaxRatePercentage(allowTaxFreeInvoices, date)
  const taxTotal = round2(netTotal * taxRate / 100)
  const total = round2(netTotal + taxTotal)
  return { netTotal, taxTotal, total }
}

const getPeriodTotal = function (periodStart, periodEnd, monthlyTotal) {
  const carry = moment(periodStart)
  periodEnd = moment(periodEnd)
  const eachMonth = {}
  while (true) {
    const endOfMonth = carry.clone().endOf('month')
    const end = periodEnd.isBefore(endOfMonth) ? periodEnd : endOfMonth
    const days = end.diff(carry, 'days') + 1
    eachMonth[carry.format('MM-YYYY')] = round5(days / carry.daysInMonth())
    if (end.isSame(periodEnd, 'month')) { break }
    carry.add(1, 'month').set('date', 1)
  }
  const months = Object.values(eachMonth).reduce((acc, val) => round5(acc + val), 0)
  return { months, total: round2(months * monthlyTotal) }
}

const getQuarterStartEnd = function (quarter) {
  const start = moment(quarter, 'Q-YYYY').format('YYYY-MM-DD')
  const end = moment(start).add(1, 'quarter').subtract(1, 'day').format('YYYY-MM-DD')
  return { start, end }
}

const getCubeSummary = function (cube) {
  const summary = cube.toJSON()
  delete summary.createdAt
  delete summary.updatedAt
  if (summary.ht) {
    summary.htId = summary.ht.objectId
    summary.htCode = summary.ht.code
    delete summary.ht
  }
  if (summary.state) {
    summary.stateId = summary.state.objectId
    summary.stateName = summary.state.name
    delete summary.state
  }
  return summary
}

const getCubeSummaries = function (cubeIds) {
  const query = new Parse.Query('Cube')
  return query.containedIn('objectId', cubeIds)
    .select(['lc', 'media', 'ht.code', 'hti', 'str', 'hsnr', 'plz', 'ort', 'state'])
    .include(['ht', 'state'])
    .limit(cubeIds.length)
    .find({ useMasterKey: true })
    .then(cubes => cubes.reduce((acc, cube) => {
      acc[cube.id] = getCubeSummary(cube)
      return acc
    }, {}))
}

// TODO: Add start datum check, so that we can finalize orders between orders. Right now we check only the end date.
async function checkIfCubesAreAvailable (order) {
  const cubeIds = order.get('cubeIds') || []
  if (!cubeIds.length) { return }
  const orderStart = order.get('startsAt')
  const orderEnd = (order.get('autoExtendsBy') && !order.get('canceledAt')) ? null : order.get('endsAt')
  const orderEarlyCancellations = order.get('earlyCancellations') || {}
  const errors = {}
  for (const cubeId of cubeIds) {
    const orderCubeEarlyCanceledAt = orderEarlyCancellations[cubeId]
    const orderCubeEnd = orderCubeEarlyCanceledAt && (!orderEnd || orderCubeEarlyCanceledAt < orderEnd) ? orderCubeEarlyCanceledAt : orderEnd
    for (const className of ['Contract', 'Booking']) {
      const query = $query(className)
        .equalTo('cubeIds', cubeId)
        .greaterThanOrEqualTo('status', 3) // is or was active
      orderCubeEnd && query.lessThan('startsAt', orderCubeEnd)
      await query
        .notEqualTo('no', order.get('no'))
        .notEqualTo(`earlyCancellations.${cubeId}`, true) // wasn't taken completely out of the contract
        .select(['no', 'startsAt', 'endsAt', 'autoExtendsBy', 'canceledAt', 'earlyCancellations'])
        .eachBatch((matches) => {
          for (const match of matches) {
            const { no, startsAt: cubeStart, endsAt, earlyCancellations, autoExtendsBy, canceledAt } = match.attributes
            let cubeEnd = ((autoExtendsBy && !canceledAt) ? null : endsAt)
            if (earlyCancellations?.[cubeId] && (!cubeEnd || earlyCancellations[cubeId] < cubeEnd)) {
              cubeEnd = earlyCancellations[cubeId]
            }
            const cubeStartsBeforeOrderEnds = Boolean(!orderCubeEnd || cubeStart <= orderCubeEnd)
            const cubeStartsAfterOrderEnds = Boolean(orderCubeEnd && cubeStart > orderCubeEnd)
            const cubeEndsBeforeOrderStarts = Boolean(cubeEnd && cubeEnd < orderStart)
            // consola.info({ orderEnd, orderCubeEnd, cubeId, cubeStart, endsAt, earlyCanceledAt: earlyCancellations?.[cubeId], cubeEnd, cubeStartsBeforeOrderEnds, cubeStartsAfterOrderEnds, cubeEndsBeforeOrderStarts })
            if (cubeStartsBeforeOrderEnds && !cubeEndsBeforeOrderStarts && !cubeStartsAfterOrderEnds) {
              if (!errors[cubeId]) { errors[cubeId] = [] }
              errors[cubeId].push(no)
            }
          }
        }, { useMasterKey: true })
    }
  }
  if (Object.keys(errors).length) {
    const messages = []
    for (const [cubeId, nos] of Object.entries(errors)) {
      messages.push(`CityCube ${cubeId} ist bereits gebucht: ${nos.join(', ')}`)
    }
    throw new Error(messages)
  }
}

// TODO: Find a more performant way to store this data
// TODO: Store past booked dates as well somewhere, to fetch status and history more actively, and to be able to show overlaps inside contract and booking pages
function getOrderSummary (bookingOrContract) {
  const { className, id: objectId } = bookingOrContract
  const {
    no,
    company,
    status,
    startsAt,
    endsAt,
    willExtend,
    autoExtendsBy,
    autoExtendsAt,
    initialDuration,
    extendedDuration,
    canceledAt,
    cubeCount,
    motive,
    externalOrderNo
  } = bookingOrContract.attributes
  return $cleanDict({
    className,
    objectId,
    booking: className === 'Booking' ? bookingOrContract.toPointer() : undefined,
    contract: className === 'Contract' ? bookingOrContract.toPointer() : undefined,
    company: company?.toPointer(),
    no,
    status,
    startsAt,
    endsAt,
    willExtend,
    autoExtendsBy,
    autoExtendsAt,
    initialDuration,
    extendedDuration,
    canceledAt,
    cubeCount,
    motive,
    externalOrderNo
  })
}

function orderSummaryIsEqual (a, b) {
  return isEqual(
    omit(a, ['booking', 'contract', 'company']),
    omit(b, ['booking', 'contract', 'company'])
  )
}

// gets the first found active order today
async function getActiveCubeOrder (cubeId) {
  const date = await $today()
  const contracts = await $query('Contract')
    .equalTo('cubeIds', cubeId)
    .greaterThanOrEqualTo('status', 3)
    .greaterThanOrEqualTo('endsAt', date) // didn't yet end
    .find({ useMasterKey: true })
  for (const contract of contracts) {
    const earlyCancellations = contract.get('earlyCancellations')
    // wasnt early canceled
    if (!earlyCancellations?.[cubeId] || earlyCancellations[cubeId] === true || earlyCancellations[cubeId] >= date) {
      return getOrderSummary(contract)
    }
  }
  const bookings = await $query('Booking')
    .equalTo('cubeIds', cubeId)
    .greaterThanOrEqualTo('status', 3)
    .greaterThanOrEqualTo('endsAt', date) // didn't yet end
    .find({ useMasterKey: true })
  for (const booking of bookings) {
    const earlyCancellations = booking.get('earlyCancellations')
    // wasnt early canceled
    if (!earlyCancellations?.[cubeId] || earlyCancellations[cubeId] === true || earlyCancellations[cubeId] >= date) {
      return getOrderSummary(booking)
    }
  }
  return null
}

async function removeAllCubeReferencesToCaok (caok, cubeIds) {
  const removed = []
  await $query('Cube')
    .notContainedIn('objectId', cubeIds)
    .equalTo('caok', caok)
    .each(cube => {
      cube.unset('order')
      removed.push(cube.id)
      // orderStatusCheck will check if any other active bookings or contracts reference this cube
      return $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
    }, { useMasterKey: true })
  return removed
}

async function setBookingCubeStatus (booking) {
  const response = { set: [], unset: [] }
  const today = moment(await $today())
  const caok = ['Booking', booking.id].join('$')
  const order = getOrderSummary(booking)
  const cube = booking.get('cube')
  const cubeOrder = cube.get('order')
  // remove all cubes that reference the booking despite the booking having them removed
  const removedCubeIds = await removeAllCubeReferencesToCaok(caok, [cube.id])
  response.unset.push(...removedCubeIds)

  const runningOrder = order.status > 2 && (order.willExtend || today.isSameOrBefore(order.endsAt, 'day'))
  if (runningOrder && !orderSummaryIsEqual(cubeOrder, order)) {
    cube.set({ order })
    response.set.push(cube.id)
    await $saveWithEncode(cube, null, { useMasterKey: true })
  } else if (!runningOrder && cubeOrder) {
    if (cubeOrder.className === 'Booking' && cubeOrder.objectId === order.objectId) {
      cube.unset('order')
      response.unset.push(cube.id)
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
    }
  }
  return response
}

async function setContractCubeStatuses (contract) {
  const response = { set: [], unset: [] }
  const today = moment(await $today())
  const order = getOrderSummary(contract)
  const caok = ['Contract', contract.id].join('$')
  const { cubeIds, earlyCancellations } = contract.attributes

  // remove all cubes that reference the contract despite the contract not having them in cubeIds
  const removedCubeIds = await removeAllCubeReferencesToCaok(caok, cubeIds)
  response.unset.push(...removedCubeIds)

  if (order.status <= 2) {
    // remove all cubes associated with order if draft
    await $query('Cube')
      .equalTo('order.className', order.className)
      .equalTo('order.objectId', order.objectId)
      .each(cube => {
        cube.unset('order')
        response.unset.push(cube.id)
        // orderStatusCheck will check if any other active bookings or contracts reference this cube
        return $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
      }, { useMasterKey: true })
    return response
  }
  const query = Parse.Query.or(
    $query('Cube').equalTo('caok', caok),
    $query('Cube').equalTo('order.className', order.className).equalTo('order.objectId', order.objectId),
    $query('Cube').containedIn('objectId', cubeIds || [])
  )
  const runningOrder = order.willExtend || today.isSameOrBefore(order.endsAt, 'day')
  if (runningOrder) {
    // first we check the status of early ending cubes
    const earlyCanceledCubeIds = Object.keys(earlyCancellations || {})
    // set the status of those cubes that were early canceled
    for (const earlyCanceledCubeId of earlyCanceledCubeIds) {
      const date = earlyCancellations[earlyCanceledCubeId]
      const cube = await $query('Cube')
        .equalTo('objectId', earlyCanceledCubeId)
        .first({ useMasterKey: true })
      // if ended, and still set remove
      const earlyCanceledAndEnded = date === true || today.isAfter(date, 'day')
      if (earlyCanceledAndEnded) {
        if (cube.get('caok') === caok) {
          response.unset.push(cube.id)
          cube.unset('order')
          // orderStatusCheck will check if any other active bookings or contracts reference this cube
          await $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
        }
        continue
      }
      const cubeOrder = {
        ...order,
        earlyCanceledAt: date,
        endsAt: moment(order.endsAt).isBefore(date) ? order.endsAt : date
      }
      if (!orderSummaryIsEqual(cube.get('order'), cubeOrder)) {
        cube.set('order', cubeOrder)
        response.set.push(cube.id)
        await $saveWithEncode(cube, null, { useMasterKey: true })
      }
    }

    query.notContainedIn('objectId', earlyCanceledCubeIds)
    await query.eachBatch(async (cubes) => {
      for (const cube of cubes) {
        if (!orderSummaryIsEqual(cube.get('order'), order)) {
          cube.set('order', order)
          response.set.push(cube.id)
          await $saveWithEncode(cube, null, { useMasterKey: true })
        }
      }
    }, { useMasterKey: true })
    return response
  }
  // if the order has ended we unset and free the cubes
  await query.equalTo('caok', caok).eachBatch(async (cubes) => {
    for (const cube of cubes) {
      cube.unset('order')
      response.unset.push(cube.id)
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
    }
  }, { useMasterKey: true })
  return response
}

// TOTRANSLATE
async function validateSystemStatus () {
  const errors = []
  const systemStatus = await Parse.Config.get().then(config => config.get('systemStatus') || {})
  const { skippedNumbers, unsyncedLexDocuments } = systemStatus
  if (skippedNumbers?.length) {
    errors.push(`Übersprungen Belegnummer: ${skippedNumbers.join(', ')}`)
  }
  if (unsyncedLexDocuments) {
    errors.push(`Es gibt ${unsyncedLexDocuments} ${unsyncedLexDocuments === 1 ? 'Beleg' : 'Belege'} in LexOffice, aber nicht in WaWi`)
  }
  if (errors.length) {
    throw new Error(errors.join(', '))
  }
}

module.exports = {
  getDocumentTotals,
  getTaxRatePercentage,
  getCubeSummary,
  getCubeSummaries,
  getQuarterStartEnd,
  getPeriodTotal,
  getNewNo,
  checkIfCubesAreAvailable,
  getActiveCubeOrder,
  setContractCubeStatuses,
  setBookingCubeStatus,
  validateSystemStatus
}
