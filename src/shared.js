const { isEqual } = require('lodash')
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
async function checkIfCubesAreAvailable (cubeIds, date, selfNo) {
  if (!date) { date = await $today() }
  for (const cubeId of cubeIds) {
    const contracts = await $query('Contract')
      .equalTo('cubeIds', cubeId)
      .greaterThanOrEqualTo('status', 3)
      .greaterThanOrEqualTo('endsAt', date) // didn't yet end
      .notEqualTo(`earlyCancellations.${cubeId}`, true) // wasn't taken completely out of the contract
      .find({ useMasterKey: true })
    for (const contract of contracts) {
      if (contract && contract.get('no') !== selfNo) {
        const { no, startsAt, endsAt, autoExtendsAt, earlyCancellations } = contract.toJSON()
        if (!earlyCancellations?.[cubeId] || earlyCancellations[cubeId] >= date) {
          consola.error({ no, startsAt, endsAt, autoExtendsAt, earlyCancellations })
          throw new Error(`CityCube ${cubeId} istist zu diesem Startdatum bereits gebucht. (${contract.get('no')})`)
        }
      }
    }
    const bookings = await $query('Booking')
      .equalTo('cubeIds', cubeId)
      .greaterThanOrEqualTo('status', 3)
      .greaterThanOrEqualTo('endsAt', date) // didn't yet end
      .find({ useMasterKey: true })
    for (const booking of bookings) {
      if (booking && booking.get('no') !== selfNo) {
        const { no, startsAt, endsAt, autoExtendsAt, earlyCancellations } = booking.toJSON()
        if (!earlyCancellations?.[cubeId] || earlyCancellations[cubeId] === true || earlyCancellations[cubeId] >= date) {
          consola.error({ no, startsAt, endsAt, autoExtendsAt, earlyCancellations })
          throw new Error(`CityCube ${cubeId} ist zu diesem Startdatum bereits gebucht. (${booking.get('no')})`)
          // throw new Error(`CityCube ${cubeId} ist bereits in Buchung ${booking.get('no')} gebucht.`)
        }
      }
    }
  }
}

// TODO: Find a more performant way to store this data
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
  return {
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
  }
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

function removeAllCubeReferencesToOrder (className, objectId, cubeIds) {
  const caok = [className, objectId].join('$')
  return $query('Cube')
    .notContainedIn('objectId', cubeIds)
    .equalTo('caok', caok)
    .each(cube => {
      cube.unset('order')
      // orderStatusCheck will check if any other active bookings or contracts reference this cube
      return $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
    }, { useMasterKey: true })
}

async function setBookingCubeStatus (booking) {
  const today = moment(await $today())
  const order = getOrderSummary(booking)
  const cube = booking.get('cube')
  const cubeOrder = cube.get('order')
  // remove all cubes that reference the booking despite the booking having them removed
  await removeAllCubeReferencesToOrder('Booking', booking.id, [cube.id])

  const runningOrder = order.status > 2 && (order.willExtend || today.isSameOrBefore(order.endsAt, 'day'))
  if (runningOrder && !isEqual(cubeOrder, order)) {
    cube.set({ order })
    consola.info('setting order', cube.id)
    return $saveWithEncode(cube, null, { useMasterKey: true })
  }
  if (!runningOrder && cubeOrder) {
    if (cubeOrder.className === 'Booking' && cubeOrder.objectId === order.objectId) {
      cube.unset('order')
      return $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
    }
  }
}

async function setContractCubeStatuses (contract) {
  const order = getOrderSummary(contract)
  const { cubeIds, earlyCancellations } = contract.attributes

  // remove all cubes that reference the contract despite the contract having them removed
  await removeAllCubeReferencesToOrder('Contract', contract.id, cubeIds)

  if (order.status <= 2) {
    // remove all cubes associated with order if draft
    return $query('Cube')
      .equalTo('order.className', order.className)
      .equalTo('order.objectId', order.objectId)
      .each(cube => {
        cube.unset('order')
        // orderStatusCheck will check if any other active bookings or contracts reference this cube
        return $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
      }, { useMasterKey: true })
  }
  const query = Parse.Query.or(
    $query('Cube').equalTo('order.className', order.className).equalTo('order.objectId', order.objectId),
    $query('Cube').containedIn('objectId', cubeIds || [])
  )
  const today = moment(await $today())
  const runningOrder = order.willExtend || today.isSameOrBefore(order.endsAt, 'day')
  if (runningOrder) {
    // first we check the status of early ending cubes
    const earlyCanceledCubeIds = Object.keys(earlyCancellations || {})
    // set the status of those cubes that were early canceled
    for (const earlyCanceledCubeId of earlyCanceledCubeIds) {
      const date = earlyCancellations[earlyCanceledCubeId]
      const cube = await $getOrFail('Cube', earlyCanceledCubeId)
      date === true || today.isAfter(date, 'day')
        ? cube.unset('order')
        : cube.set('order', {
          ...order,
          earlyCanceledAt: date,
          endsAt: moment(order.endsAt).isBefore(date) ? order.endsAt : date
        })
      await $saveWithEncode(cube, null, { useMasterKey: true })
    }

    query.notContainedIn('objectId', earlyCanceledCubeIds)
    return query.each((cube) => {
      cube.set('order', order)
      return $saveWithEncode(cube, null, { useMasterKey: true })
    }, { useMasterKey: true })
  }
  // if the order has ended we unset and free the cubes
  return query.each((cube) => {
    cube.unset('order')
    return $saveWithEncode(cube, null, { useMasterKey: true, context: { orderStatusCheck: true } })
  }, { useMasterKey: true })
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
    errors.push(`There are ${unsyncedLexDocuments} vouchers in LexOffice that are not in WaWi`)
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
