const { kebabCase } = require('lodash')
const { normalizeDateString, normalizeString } = require('@/schema/normalizers')
const { generateExtensionInvoices } = require('./classes/contracts')
const {
  // getOrderClassName,
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
Parse.Cloud.define('order-extend', async ({ params: { className, id, email, extendBy }, user, master }) => {
  if (!master && !['intern', 'admin'].includes(user.get('accType'))) {
    const isBookingManagerPartner = className === 'Booking' && user.get('accType') === 'partner' && user.get('permissions').includes('manage-bookings')
    if (!isBookingManagerPartner) {
      throw new Error('Unbefugter Zugriff.')
    }
  }

  const order = await $getOrFail(className, id)
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

  const audit = { user, fn: kebabCase(className) + '-extend', data: { extendBy, endsAt: [previousEndsAt, order.get('endsAt')] } }

  let message = 'Auftrag wurde verlängert.'
  if (className === 'Contract') {
    if (email === true) {
      email = order.get('company').get('email')
    }
    email && await Parse.Cloud.run('contract-extend-send-mail', { id: order.id, email }, { useMasterKey: true })
      .then(() => { message += ` Email an ${email} gesendet.` })
  }
  await order.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  if (className === 'Contract') {
    message += await generateExtensionInvoices(order.id, newEndsAt, previousEndsAt)
  }
  return message
})

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
