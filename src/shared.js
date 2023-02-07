const { round2, round5, parseAsDigitString } = require('@/utils')

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

function getPeriodEnd ({ periodStart, billingCycle, contractStart, initialDuration }) {
  periodStart = moment(periodStart)
  const addMonths = billingCycle - (periodStart.month() % billingCycle)
  const nextPeriodStart = periodStart.clone().add(addMonths, 'months').set('date', 1)
  // check contract cut, if the invoice period starts after the initial contract duration
  const contractCut = nextPeriodStart.isAfter(moment(contractStart).add(initialDuration, 'months'))
    ? moment(contractStart).subtract(1, 'day').year(periodStart.year())
    : null
  return contractCut && contractCut.isBetween(periodStart, nextPeriodStart, 'day', '[)')
    ? contractCut
    : nextPeriodStart.subtract(1, 'days')
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

const getCubeSummaries = function (cubeIds) {
  const query = new Parse.Query('Cube')
  return query.containedIn('objectId', cubeIds)
    .select(['lc', 'media', 'ht.code', 'hti', 'str', 'hsnr', 'plz', 'ort', 'state'])
    .include(['ht', 'state'])
    .limit(cubeIds.length)
    .find({ useMasterKey: true })
    .then(cubes => cubes.reduce((acc, cube) => {
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
      acc[cube.id] = summary
      return acc
    }, {}))
}

async function checkIfCubesAreAvailable (cubeIds, date) {
  if (!date) {
    date = await $today()
  }
  for (const cubeId of cubeIds) {
    const contracts = await $query('Contract')
      .equalTo('cubeIds', cubeId)
      .greaterThanOrEqualTo('status', 3)
      .greaterThanOrEqualTo('endsAt', date) // didn't yet end
      .find({ useMasterKey: true })
    for (const contract of contracts) {
      if (contract) {
        const { no, startsAt, endsAt, autoExtendsAt, earlyCancellations } = contract.toJSON()
        if (!earlyCancellations?.[cubeId] || earlyCancellations[cubeId] >= date) {
          consola.error({ no, startsAt, endsAt, autoExtendsAt, earlyCancellations })
          throw new Error(`CityCube ${cubeId} ist bereits in Vertrag ${contract.get('no')} gebucht.`)
        }
      }
    }
    const bookings = await $query('Booking')
      .equalTo('cubeIds', cubeId)
      .greaterThanOrEqualTo('status', 3)
      .greaterThanOrEqualTo('endsAt', date) // didn't yet end
      .find({ useMasterKey: true })
    for (const booking of bookings) {
      if (booking) {
        const { no, startsAt, endsAt, autoExtendsAt, earlyCancellations } = booking.toJSON()
        if (!earlyCancellations?.[cubeId] || earlyCancellations[cubeId] >= date) {
          consola.error({ no, startsAt, endsAt, autoExtendsAt, earlyCancellations })
          throw new Error(`CityCube ${cubeId} ist bereits in Buchung ${booking.get('no')} gebucht.`)
        }
      }
    }
  }
}

async function setCubeOrderStatuses (bookingOrContract) {
  const {
    no,
    company,
    cubeIds,
    status,
    startsAt,
    endsAt,
    autoExtendsBy,
    autoExtendsAt,
    canceledAt,
    earlyCancellations
  } = bookingOrContract.attributes
  const { className, id: objectId } = bookingOrContract
  const order = {
    className,
    objectId,
    booking: className === 'Booking' ? bookingOrContract.toPointer() : undefined,
    contract: className === 'Contract' ? bookingOrContract.toPointer() : undefined,
    company: company?.toPointer(),
    no,
    status,
    startsAt,
    endsAt,
    autoExtendsBy,
    autoExtendsAt,
    canceledAt
  }
  if (status < 3) {
    // remove all cubes associated with order if draft
    await $query('Cube')
      .equalTo('order.className', order.className)
      .equalTo('order.objectId', order.objectId)
      .each(cube => {
        cube.unset('order')
        return cube.save(null, { useMasterKey: true })
      }, { useMasterKey: true })
  } else {
    // remove all cubes that reference the contract despite the contract having them removed
    await $query('Cube')
      .notContainedIn('objectId', cubeIds)
      .equalTo('order.className', order.className)
      .equalTo('order.objectId', order.objectId)
      .each(cube => {
        cube.unset('order')
        return cube.save(null, { useMasterKey: true })
      }, { useMasterKey: true })
  }

  const query = Parse.Query.or(
    $query('Cube').equalTo('order.className', order.className).equalTo('order.objectId', order.objectId),
    $query('Cube').containedIn('objectId', cubeIds || [])
  )
  const today = moment(await $today())
  const runningOrder = (autoExtendsAt && !canceledAt) || today.isSameOrBefore(endsAt, 'day')
  if (runningOrder) {
    // first we check the status of early ending cubes
    const earlyCanceledCubeIds = Object.keys(earlyCancellations || {})
    // set the status of those cubes that were early canceled
    for (const earlyCanceledCubeId of earlyCanceledCubeIds) {
      const date = earlyCancellations[earlyCanceledCubeId]
      const cube = await $getOrFail('Cube', earlyCanceledCubeId)
      today.isSameOrBefore(date, 'day')
        ? cube.set('order', {
          ...order,
          earlyCanceledAt: date,
          endsAt: moment(endsAt).isBefore(date) ? endsAt : date
        })
        : cube.unset('order')
      await cube.save(null, { useMasterKey: true })
    }

    query.notContainedIn('objectId', earlyCanceledCubeIds)
    return query.each(cube => cube.set('order', { ...order, endsAt }).save(null, { useMasterKey: true }), { useMasterKey: true })
  }
  // if the order has ended we unset and free the cubes
  return query.each(cube => cube.unset('order').save(null, { useMasterKey: true }), { useMasterKey: true })
}

module.exports = {
  getDocumentTotals,
  getTaxRatePercentage,
  getCubeSummaries,
  getQuarterStartEnd,
  getPeriodEnd,
  getPeriodTotal,
  getNewNo,
  checkIfCubesAreAvailable,
  setCubeOrderStatuses
}
