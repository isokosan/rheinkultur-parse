const { kebabCase, intersection } = require('lodash')
const { normalizeDateString, normalizeString } = require('@/schema/normalizers')
const { generateExtensionInvoices } = require('./classes/contracts')
const {
  ORDER_CLASSES,
  setOrderCubeStatuses
} = require('@/shared')

Parse.Cloud.define('order-set-cube-statuses', async ({ params: { className, id } }) => {
  const order = await $getOrFail(className, id)
  return setOrderCubeStatuses(order)
}, $internOrAdmin)

Parse.Cloud.define('order-cancel', async ({ params: { className, id, endsAt, comments: cancelNotes }, user }) => {
  const order = await $getOrFail(className, id)
  endsAt = normalizeDateString(endsAt)
  cancelNotes = normalizeString(cancelNotes)

  if (order.get('status') < 3) {
    throw new Error('Nur finalisierte Aufträge können gekündigt werden.')
  }
  if (!order.get('autoExtendsBy') && endsAt === order.get('endsAt')) {
    throw new Error('Bitte geben Sie ein neues Enddatum ein.')
  }

  const changes = $changes(order, { endsAt, cancelNotes })
  const audit = { user, fn: kebabCase(className) + '-cancel', data: { changes, cancelNotes } }
  let message = 'Auftrag gekündigt.'
  if (order.get('canceledAt')) {
    audit.data.wasCanceled = true
    message = 'Kündigung geändert.'
  }

  order.set({ endsAt, canceledAt: new Date(), cancelNotes })
  if (order.get('status') > 3) {
    order.set('status', 3)
    message += ' Status auf Aktiv gestellt. Bitte prüfen Sie den Status des Auftrags.'
  }
  await order.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  if (moment(endsAt).isBefore(await $today(), 'day') && order.get('status') === 3) {
    await Parse.Cloud.run('order-end', { className, id }, { useMasterKey: true })
    message += ' Auftrag beendet.'
  }
  if (className === 'Contract') {
    const updatedInvoices = await Parse.Cloud.run('contract-update-planned-invoices', { id }, { useMasterKey: true })
    message += ` ${updatedInvoices} Rechnungen aktualisiert.`
  }
  return message
}, $internOrAdmin)

Parse.Cloud.define('order-cancel-cancel', async ({ params: { className, id, endsAt }, user }) => {
  const order = await $getOrFail(className, id)
  endsAt = normalizeDateString(endsAt)
  const changes = $changes(order, { endsAt })
  const audit = { user, fn: kebabCase(className) + '-cancel-cancel', data: { changes } }
  order.set({ endsAt, canceledAt: null, cancelNotes: null })
  let message = 'Kündigung widergerufen.'
  if (order.get('status') > 3) {
    order.set('status', 3)
    order.set('canceledAt', null)
    message += ' Status auf Aktiv gestellt. Bitte prüfen Sie den Status des Auftrags.'
  }
  await order.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  if (className === 'Contract') {
    const updatedInvoices = await Parse.Cloud.run('contract-update-planned-invoices', { id }, { useMasterKey: true })
    message += ` ${updatedInvoices} Rechnungen aktualisiert.`
  }
  return message
}, $internOrAdmin)

Parse.Cloud.define('order-void', async ({ params: { className, id, comments: cancelNotes }, user }) => {
  const order = await $getOrFail(className, id)
  if (order.get('status') <= 2) {
    throw new Error('Dies ist ein Entwurf. Bitte löschen Sie den Auftrag stattdessen.')
  }
  cancelNotes = normalizeString(cancelNotes)
  order.set({
    status: -1,
    voidedAt: new Date(),
    canceledAt: null,
    cancelNotes
  })
  const audit = { user, fn: kebabCase(className) + '-void', data: { cancelNotes } }
  await order.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  let message = 'Auftrag storniert.'
  if (className === 'Contract') {
    const updatedInvoices = await Parse.Cloud.run('contract-update-planned-invoices', { id }, { useMasterKey: true })
    message += ` ${updatedInvoices} Rechnungen aktualisiert.`
  }
  return message
}, $internOrAdmin)

/**
 * When any order gets extended
 */
Parse.Cloud.define('order-extend', async ({ params: { className, id, email, extendBy, updatePrices }, user, master }) => {
  if (!master && !['intern', 'admin'].includes(user.get('accType'))) {
    const isBookingManagerPartner = className === 'Booking' && user.get('accType') === 'partner' && user.get('permissions').includes('manage-bookings')
    if (!isBookingManagerPartner) {
      throw new Error('Unbefugter Zugriff.')
    }
  }

  const order = await $getOrFail(className, id, ['company', 'cubeData'])
  if (order.get('status') !== 3) {
    throw new Error('Nur laufende Aufträge können verlängert werden.')
  }
  if (order.get('canceledAt')) {
    throw new Error('Gekündigte Aufträge können nicht verlängert werden.')
  }
  extendBy = extendBy || order.get('autoExtendsBy')
  if (!extendBy || ![3, 6, 12].includes(parseInt(extendBy))) {
    throw new Error('Verlängerungsanzahl nicht gesetzt.')
  }
  extendBy = parseInt(extendBy)

  const previousEndsAt = order.get('endsAt')
  const newExtendedDuration = (order.get('extendedDuration') || 0) + extendBy
  const newTotalDuration = order.get('initialDuration') + newExtendedDuration
  const newEndsAt = moment(order.get('startsAt')).add(newTotalDuration, 'months').subtract(1, 'day')

  order.set({
    endsAt: newEndsAt.format('YYYY-MM-DD'),
    extendedDuration: newExtendedDuration
  })
  let message = 'Auftrag wurde verlängert.'

  const audit = { user, fn: kebabCase(className) + '-extend', data: { extendBy, endsAt: [previousEndsAt, order.get('endsAt')] } }

  let fixedPricesUpdated
  if (updatePrices && order.get('company').get('contractDefaults')?.updateFixedPrices) {
    const { pricingModel, fixedPrice, fixedPriceMap } = order.get('company').get('contractDefaults') || {}
    if (order.get('pricingModel') !== 'fixed' || pricingModel !== 'fixed') {
      throw new Error('Nur feste Preise können aktualisiert werden.')
    }
    const monthlyMedia = {}
    for (const cubeId of order.get('cubeIds')) {
      if (fixedPrice) {
        monthlyMedia[cubeId] = fixedPrice
      }
      if (fixedPriceMap) {
        const { media } = order.get('cubeData')[cubeId]
        monthlyMedia[cubeId] = fixedPriceMap[media]
      }
    }
    const changes = $changes(order, { monthlyMedia })
    // if prices did not change throw error
    if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
    order.set({ monthlyMedia })
    audit.data.changes = changes
    message += ' Preisen aktualisiert.'
    fixedPricesUpdated = 'Die Preise des Vertrags wurden aktualisiert.'
  }

  if (className === 'Contract') {
    if (email === true) {
      email = order.get('company').get('email')
    }
    email && await Parse.Cloud.run('contract-extend-send-mail', { id: order.id, email, fixedPricesUpdated }, { useMasterKey: true })
      .then(() => { message += ` Email an ${email} gesendet.` })
  }

  await order.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  if (className === 'Contract') {
    message += await generateExtensionInvoices(order.id, newEndsAt, previousEndsAt)
  }
  return message
}, { requireUser: true })

/**
 * When any order ends
 *   the order is set to "Ausgelaufen or Gekündikt"
 *   the werbemedien inside the aufdtrag are freed on order beforesave
 */
Parse.Cloud.define('order-end', async ({ params: { className, id }, user }) => {
  const order = await $getOrFail(className, id)
  if (order.get('status') !== 3) {
    throw new Error('Nur laufende Aufträge können beendet werden.')
  }
  if (moment(order.get('endsAt')).isSameOrAfter(await $today(), 'day')) {
    throw new Error('Nur beendete Aufträge können als beendet markiert werden.')
  }
  order.set({ status: order.get('canceledAt') ? 4 : 5 })
  const audit = { user, fn: kebabCase(className) + '-end' }
  return order.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, $internOrAdmin)

/**
 * Gather order issues
 *  check if there are any issues on given cubeIds
 */
// TODO: Refactor this function to only send in order keys, and filter flags by null only as [] does not work
Parse.Cloud.define('order-finalize-issues', async ({ params: { className, objectId, cubeIds } }) => {
  const orderKey = className + '$' + objectId
  const hasCO = $query('Cube').notEqualTo('caok', null).notEqualTo('caok', orderKey)
  const hasFO = $query('Cube').notEqualTo('ffok', null).notEqualTo('ffok', orderKey)
  const hasFM = $query('Cube').notEqualTo('fmk', null).notEqualTo('fmk', orderKey)
  const hasFlags = $query('Cube').notEqualTo('flags', null)
  const issues = await Parse.Query.or(hasCO, hasFO, hasFM, hasFlags)
    .containedIn('objectId', cubeIds)
    .limit(cubeIds.length)
    .select(['order', 'futureOrder', 'fm', 'flags'])
    .find({ useMasterKey: true })
    .then((cubes) => cubes
      .reduce((acc, { id, attributes: { order, futureOrder, fm, flags } }) => {
        const cube = $cleanDict({
          order: order && order.className + '$' + order.objectId === orderKey ? undefined : order,
          futureOrder: futureOrder && futureOrder.className + '$' + futureOrder.objectId === orderKey ? undefined : futureOrder,
          fm: fm && fm.frameMount.className + '$' + fm.frameMount.id === orderKey ? undefined : fm,
          flags: flags?.length ? flags : undefined
        })
        if (cube) {
          acc[id] = cube
        }
        return acc
      }, {})
    )
  const orders = await Promise.all(ORDER_CLASSES.map((orderClass) => {
    const query = $query(orderClass)
    if (orderClass === className) {
      query.notEqualTo('objectId', objectId)
    }
    cubeIds.length === 1 ? query.equalTo('cubeIds', cubeIds[0]) : query.containedBy('cubeIds', cubeIds)
    return query
      .greaterThanOrEqualTo('status', 0)
      .lessThanOrEqualTo('status', 2.1)
      .find({ useMasterKey: true })
      .then(orders => orders.map(order => ({ className: orderClass, ...order.toJSON() })))
  })).then(orders => orders.flat())
  for (const order of orders) {
    for (const cubeId of intersection(order.cubeIds, cubeIds)) {
      issues[cubeId] = issues[cubeId] || {}
      issues[cubeId].draftOrders = issues[cubeId].draftOrders || []
      issues[cubeId].draftOrders.push(order)
    }
  }
  return issues
})
