const { v4: uuidv4 } = require('uuid')
const { normalizeDateString, normalizeString, bookings: { UNSET_NULL_FIELDS, normalizeFields } } = require('@/schema/normalizers')
const { indexBooking, unindexBooking, indexBookingRequests, unindexBookingRequests } = require('@/cloud/search')

const { round2 } = require('@/utils')
const { getNewNo, checkIfCubesAreAvailable, validateOrderFinalize, setOrderCubeStatuses, earlyCancelSpecialFormats } = require('@/shared')

const Booking = Parse.Object.extend('Booking')

Parse.Cloud.beforeSave(Booking, async ({ object: booking }) => {
  booking.isNew() && !booking.get('no') && booking.set({ no: await getNewNo('B' + moment(await $today()).format('YY') + '-', Booking, 'no') })
  UNSET_NULL_FIELDS.forEach(field => !booking.get(field) && booking.unset(field))

  const request = booking.get('request')
  if (request) {
    !request.id && (request.id = uuidv4())
    booking.set({ request })
  }

  const company = booking?.get('company')
  if (company) {
    await company.fetch({ useMasterKey: true })
    if (!company.get('distributor')) {
      throw new Error('Buchungen können nur bei Vertriebspartner angelegt werden.')
    }
  }

  booking.set('totalDuration', (booking.get('initialDuration') || 0) + (booking.get('extendedDuration') || 0))
  const canceled = Boolean(booking.get('canceledAt') || booking.get('voidedAt'))
  !canceled && booking.set('autoExtendsAt', booking.get('autoExtendsBy') ? moment(booking.get('endsAt')).format('YYYY-MM-DD') : null)

  // cubes
  !booking.get('cubeIds') && booking.set('cubeIds', [])
  booking.set('cubeCount', (booking.get('cubeIds') || []).length)
  if (booking.get('cubeCount') > 1) {
    throw new Error('Bookings can only include one cube. Please make multiple bookings instead.')
  }
  const cubeId = booking.get('cubeIds')?.[0]
  if (!cubeId) {
    booking.unset('cube')
  } else if (booking.get('cube')?.id !== cubeId) {
    const cube = await $getOrFail('Cube', cubeId)
    booking.set('cube', cube)
  }

  // make sure monthlyMedia is only allowing for this single cube
  if (booking.get('monthlyMedia')) {
    const monthlyMedia = booking.get('monthlyMedia')
    if (Object.keys(monthlyMedia || {}).length) {
      for (const id of Object.keys(monthlyMedia || {})) {
        if (id !== cubeId) {
          delete monthlyMedia[id]
        }
      }
    }
    Object.keys(monthlyMedia).length ? booking.set('monthlyMedia', monthlyMedia) : booking.unset('monthlyMedia')
  }
})

Parse.Cloud.afterSave(Booking, async ({ object: booking, context: { audit, setCubeStatuses } }) => {
  await indexBooking(booking)
  await indexBookingRequests(booking)
  setCubeStatuses && await setOrderCubeStatuses(booking)
  audit && $audit(booking, audit)
})

Parse.Cloud.beforeFind(Booking, ({ query, user }) => {
  // always attach cube
  query.include('cube')
  // if partner, only self bookings
  if (user?.get('accType') === 'partner' && user.get('company')) {
    query.equalTo('company', user.get('company'))
  }
  query._include.includes('all') && query.include([
    'company',
    'companyPerson',
    'cubeData',
    'production',
    'docs'
  ])
  !query._include.includes('cubeData') && query.exclude('cubeData')
})

Parse.Cloud.afterFind(Booking, async ({ objects: bookings, query }) => {
  for (const booking of bookings) {
    // get computed property willExtend
    const willExtend = booking.get('autoExtendsBy') && !booking.get('canceledAt')
    booking.set('willExtend', willExtend)

    if (query._include.includes('production')) {
      booking.set('production', await $query('Production').equalTo('booking', booking).first({ useMasterKey: true }))
    }
  }
  return bookings
})

Parse.Cloud.beforeDelete(Booking, async ({ object: booking }) => {
  await unindexBooking(booking)
  await unindexBookingRequests(booking)
})

Parse.Cloud.afterDelete(Booking, $deleteAudits)

async function validatePricing ({ company, cubeIds, endPrices, monthlyMedia }) {
  if (company) {
    await company.fetch({ useMasterKey: true })
    const pricingModel = company.get('distributor').pricingModel
    if (pricingModel === 'commission') {
      for (const cubeId of cubeIds) {
        if (!endPrices?.[cubeId]) {
          throw new Error('Sie müssen eine Monatsmiete eintragen.')
        }
      }
    }
    // check if all cubes are media verified, if fixed pricing depends on media
    if (pricingModel === 'fixed' && !company.get('distributor').fixedPrice) {
      const noMediaCubes = await $query('Cube')
        .containedIn('objectId', cubeIds)
        .equalTo('media', null)
        .find({ useMasterKey: true })
      if (noMediaCubes.length > 0) {
        throw new Error('Media kann nicht gesetzt werden, weil Gehäuse-Kategorie von einigen CityCubes unbekannt ist. Bitte wählen Sie eine Kategorie aus.')
      }
    }
    if (!pricingModel) {
      for (const cubeId of cubeIds) {
        if (!monthlyMedia?.[cubeId]) {
          throw new Error('Sie müssen eine Monatsmiete eintragen.')
        }
      }
    }
  }
  if (!company) {
    for (const cubeId of cubeIds) {
      if (monthlyMedia?.[cubeId]) {
        throw new Error('Alle medien muss 0€ sein.')
      }
    }
  }
}

async function validateBookingFinalize (booking) {
  await validateOrderFinalize(booking)
  // validate production
  const production = await $query('Production').equalTo('booking', booking).first({ useMasterKey: true })
  if (production) {
    const printPackages = production.get('printPackages')
    for (const cubeId of booking.get('cubeIds')) {
      if (!(cubeId in printPackages) || !printPackages[cubeId]) {
        throw new Error('Sie müssen für alle Werbemedien ein Belegungspaket auswählen.')
      }
    }
  }

  await validatePricing({
    company: booking.get('company'),
    cubeIds: booking.get('cubeIds'),
    endPrices: booking.get('endPrices'),
    monthlyMedia: booking.get('monthlyMedia')
  })
}

/**
 * Generates a booking with cubeids
 */
Parse.Cloud.define('booking-generate', async ({ params, user }) => {
  const {
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    cubeIds
  } = normalizeFields(params)
  const booking = new Booking({
    status: 2,
    motive,
    externalOrderNo,
    campaignNo,
    cubeIds,
    responsibles: user ? [user] : undefined
  })
  companyId && booking.set({ company: await $getOrFail('Company', companyId) })
  companyPersonId && booking.set({ companyPerson: await $getOrFail('Person', companyPersonId) })
  booking.get('company') && booking.set({ tags: booking.get('company').get('tags') })
  const audit = { user, fn: 'booking-generate' }
  return booking.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

/**
 * Creates a booking with the basic settings.
 * Cubes and amounts are handled later
 */
Parse.Cloud.define('booking-create', async ({ params, user, master }) => {
  const {
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsBy,
    disassemblyFromRMV
  } = normalizeFields(params)

  const booking = new Booking({
    no: master ? params.no : undefined,
    status: 2,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration: parseInt(initialDuration),
    endsAt,
    autoExtendsBy,
    responsibles: user ? [user] : undefined,
    disassembly: disassemblyFromRMV
      ? { fromRMV: true }
      : null
  })
  companyId && booking.set({ company: await $getOrFail('Company', companyId) })
  companyPersonId && booking.set({ companyPerson: await $getOrFail('Person', companyPersonId) })

  booking.get('company') && booking.set({ tags: booking.get('company').get('tags') })

  const audit = { user, fn: 'booking-create' }
  return booking.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('booking-update-cubes', async ({ params: { id: bookingId, ...params }, user }) => {
  const booking = await $getOrFail(Booking, bookingId)
  const { cubeIds } = normalizeFields(params)
  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(booking, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  booking.set({ cubeIds })
  const production = await $query('Production').equalTo('booking', booking).first({ useMasterKey: true })
  production && production.save(null, { useMasterKey: true })

  const audit = { user, fn: 'booking-update', data: { cubeChanges } }
  return booking.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('booking-update', async ({
  params: {
    id: bookingId,
    endPrices,
    monthlyMedia,
    production,
    ...params
  }, user
}) => {
  const {
    cubeIds,
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsBy,
    disassemblyFromRMV
  } = normalizeFields(params)

  const booking = await $getOrFail(Booking, bookingId)
  $cubeLimit(cubeIds.length)

  const cubeChanges = $cubeChanges(booking, cubeIds)
  cubeChanges && booking.set({ cubeIds })

  const company = companyId ? await $getOrFail('Company', companyId) : null
  const pricingModel = company ? company.get('distributor').pricingModel : null
  if (pricingModel !== 'commission') { endPrices = null }
  if (pricingModel) { monthlyMedia = null }
  endPrices = $cleanDict(endPrices)
  monthlyMedia = $cleanDict(monthlyMedia)

  const changes = $changes(booking, {
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsBy,
    monthlyMedia,
    endPrices
  })
  booking.set({
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsBy,
    monthlyMedia,
    endPrices
  })

  const disassembly = booking.get('disassembly') || {}
  // add disassemblyFromRMV
  if (disassemblyFromRMV !== Boolean(disassembly.fromRMV)) {
    changes.disassemblyFromRMV = [Boolean(disassembly.fromRMV), disassemblyFromRMV]
    disassembly.fromRMV = disassemblyFromRMV
    booking.set({ disassembly })
  }

  if (companyId !== booking.get('company')?.id) {
    changes.companyId = [booking.get('company')?.id, companyId]
    const company = companyId ? await $getOrFail('Company', companyId, ['tags']) : null
    booking.set({ company })
    // override company tags
    company?.get('tags') ? booking.set('tags', company.get('tags')) : booking.unset('tags')
  }

  if (companyPersonId !== booking.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [booking.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    booking.set({ companyPerson })
  }

  let productionChanges = {}
  const existingProduction = await $query('Production').equalTo('booking', booking).first({ useMasterKey: true })
  if (production) {
    const { billing, printPackages, interestRate, prices, extras, totals } = production
    const cubeIds = booking.get('cubeIds') || []
    // clean print packages for missing cubes in booking
    for (const cubeId of Object.keys(printPackages || {})) {
      if (!cubeIds.includes(cubeId)) {
        delete printPackages[cubeId]
      }
    }
    productionChanges = existingProduction
      ? $changes(existingProduction, {
        billing,
        printPackages,
        prices: billing ? prices : null,
        extras: billing ? extras : null
      })
      : { added: true }
    production = existingProduction || new (Parse.Object.extend('Production'))()
    production.set({ booking, billing, printPackages, interestRate: null, prices: null, extras: null, totals: null })
    if (billing) {
      const installments = billing > 1 ? billing : null
      let productionTotal = 0
      production.set({ prices, extras, totals })
      const monthlies = {}
      for (const cubeId of Object.keys(printPackages)) {
        const cubeTotal = totals?.[cubeId] || 0
        if (installments) {
          monthlies[cubeId] = round2(cubeTotal / installments)
        }
        productionTotal += cubeTotal
      }
      installments && production.set({ interestRate, monthlies })
      production.set({ total: round2(productionTotal) })
    }
    await production.save(null, { useMasterKey: true })
  }

  if (!production && existingProduction) {
    productionChanges = { removed: true }
    await existingProduction.destroy({ useMasterKey: true })
  }

  const audit = { user, fn: 'booking-update', data: { changes, cubeChanges, productionChanges } }
  return booking.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('booking-finalize', async ({ params: { id: bookingId }, user }) => {
  const booking = await $getOrFail(Booking, bookingId, 'cube')
  await validateBookingFinalize(booking)

  // check if any special formats need to be canceled early
  await earlyCancelSpecialFormats(booking)

  // save cube data in time of finalization
  const cube = booking.get('cube')
  const cubeData = {
    [cube.id]: {
      hsnr: cube.get('hsnr'),
      str: cube.get('str'),
      plz: cube.get('plz'),
      ort: cube.get('ort'),
      stateId: cube.get('state').id,
      media: cube.get('media'),
      htId: cube.get('ht')?.id
    }
  }

  booking.set({ status: 3, cubeData })
  const audit = { user, fn: 'booking-finalize' }
  await booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Buchung finalisiert.'
}, $internOrAdmin)

// TODO: Make sure to give option to update cube data
Parse.Cloud.define('booking-undo-finalize', async ({ params: { id: bookingId }, user }) => {
  const booking = await $getOrFail(Booking, bookingId)
  booking.set({ status: 2.1 })
  const audit = { user, fn: 'booking-undo-finalize' }
  await booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Finalisierung zurückgezogen.'
}, $internOrAdmin)

/**
 * When a booking is canceled on a given date
 *   the cubes will become available when endsAt date is reached
 */
Parse.Cloud.define('booking-cancel', async ({
  params: {
    id: bookingId,
    endsAt,
    comments: cancelNotes
  }, user
}) => {
  endsAt = normalizeDateString(endsAt)
  cancelNotes = normalizeString(cancelNotes)

  const booking = await $getOrFail(Booking, bookingId)
  if (booking.get('status') !== 3) {
    throw new Error('Nur laufende Buchungen können gekündigt werden.')
  }
  if (!booking.get('autoExtendsBy') && endsAt === booking.get('endsAt')) {
    throw new Error('Bitte geben Sie ein neues Enddatum ein.')
  }

  const changes = $changes(booking, { endsAt, cancelNotes })
  const wasCanceled = Boolean(booking.get('canceledAt'))
  booking.set({ endsAt, canceledAt: new Date(), cancelNotes })
  const audit = { user, fn: 'booking-cancel', data: { changes, cancelNotes } }
  if (wasCanceled) {
    audit.data.wasCanceled = true
  }
  await booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  if (moment(endsAt).isBefore(await $today(), 'day')) {
    await Parse.Cloud.run('booking-end', { id: booking.id }, { useMasterKey: true })
  }
  return wasCanceled ? 'Kündigung geändert.' : 'Buchung gekündigt.'
}, $internOrAdmin)

Parse.Cloud.define('booking-cancel-cancel', async ({
  params: {
    id: bookingId,
    endsAt
  }, user
}) => {
  const booking = await $getOrFail(Booking, bookingId)
  endsAt = normalizeDateString(endsAt)
  const changes = $changes(booking, { endsAt })
  const audit = { user, fn: 'booking-cancel-cancel', data: { changes } }
  booking.set({ endsAt, canceledAt: null, cancelNotes: null })
  let message = 'Kündigung zurückgerufen.'
  if (booking.get('status') > 3) {
    booking.set('status', 3)
    booking.set('canceledAt', null)
    message += ' Buchung status auf Aktiv gestellt. Bitte überprüfen Sie den Status der Buchung.'
  }
  await booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return message
}, $internOrAdmin)

/**
 * When a booking is ended
 *   the booking status is set to "Ausgelaufen or Gekündikt"
 *   the werbemedien inside the booking are freed via cube beforesave
 */
Parse.Cloud.define('booking-end', async ({ params: { id: bookingId }, user }) => {
  const booking = await $getOrFail(Booking, bookingId)
  if (booking.get('status') !== 3) {
    throw new Error('Nur laufende Buchungen können beendet werden.')
  }
  if (moment(booking.get('endsAt')).isSameOrAfter(await $today(), 'day')) {
    throw new Error('Nur beendete Buchungen können als beendet markiert werden.')
  }
  booking.set({ status: booking.get('canceledAt') ? 4 : 5 })
  const audit = { user, fn: 'booking-end' }
  return booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, $internOrAdmin)

Parse.Cloud.define('booking-void', async ({ params: { id: bookingId, comments: cancelNotes }, user }) => {
  const booking = await $getOrFail(Booking, bookingId)
  // do not allow deleting if partner booking request (only partner can delete)
  if (booking.get('request')) {
    if (user.get('accType') !== 'partner' || user.get('company').id !== booking.get('company').id) {
      throw new Error('To void booking requests please reject the request instead.')
    }
  }
  if (booking.get('status') <= 2) {
    throw new Error('This is a draft booking. Please remove the booking instead.')
  }
  cancelNotes = normalizeString(cancelNotes)
  booking.set({
    status: -1,
    voidedAt: new Date(),
    canceledAt: null,
    cancelNotes
  })
  const audit = { user, fn: 'booking-void', data: { cancelNotes } }
  await booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Buchung storniert.'
}, $internOrAdmin)

Parse.Cloud.define('booking-remove', async ({ params: { id: bookingId }, user }) => {
  const booking = await $getOrFail(Booking, bookingId)

  // do not allow deleting if partner booking request (only partner can delete)
  if (booking.get('request')) {
    if (user.get('accType') !== 'partner' || user.get('company').id !== booking.get('company').id) {
      throw new Error('To remove booking requests please reject the request instead.')
    }
  }
  if (booking.get('status') !== 0 && booking.get('status') !== 2) {
    throw new Error('Nur Entwürfe können gelöscht werden.')
  }
  return booking.destroy({ useMasterKey: true })
}, $internOrAdmin)

Parse.Cloud.define('booking-production-invoice', async ({ params: { id: bookingId } }) => {
  const booking = await $query(Booking).include(['company', 'production']).get(bookingId, { useMasterKey: true })
  const production = booking.get('production')
  if (!production) {
    throw new Error('No production found!')
  }
  const cubeIds = booking.get('cubeIds') || []
  if (!cubeIds.length) {
    throw new Error('Production needs werbemittel')
  }
  const printPackages = production.get('printPackages')
  for (const cubeId of cubeIds) {
    if (!(cubeId in printPackages) || !printPackages[cubeId]) {
      throw new Error('Sie müssen für alle Werbemedien ein Belegungspaket auswählen.')
    }
  }

  const Invoice = Parse.Object.extend('Invoice')
  const invoice = await $query('Invoice')
    .equalTo('production.id', production.id)
    .first({ useMasterKey: true }) || new Invoice()
  if (invoice.get('status')) {
    return 'Invoice is already issued'
  }
  const company = booking.get('company')
  const productionItems = []
  for (const cubeId of Object.keys(production.get('printPackages'))) {
    const itemTotal = round2(production.get('totals')?.[cubeId] || 0)
    productionItems.push({
      cubeId,
      orderId: `B:${booking.id}`,
      no: production.get('printPackages')?.[cubeId]?.no,
      total: itemTotal
    })
  }
  invoice.set({
    status: 0,
    date: booking.get('startsAt'),
    company,
    booking,
    paymentType: company.get('paymentType'),
    dueDays: company.get('dueDays'),
    production: {
      id: production.id,
      items: productionItems,
      total: production.get('total')
    },
    lineItems: [{
      name: 'Produktion und Montage',
      price: production.get('total')
    }]
  })
  const message = invoice.id ? 'Invoice draft updated' : 'Invoice draft generated'
  await invoice.save(null, { useMasterKey: true })
  return message
}, $internOrAdmin)

// Requests

/**
 * Process a booking submit
 */
Parse.Cloud.define('booking-create-request', async ({ params, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings')) {
    throw new Error('Unbefugter Zugriff')
  }
  const cube = await $getOrFail('Cube', params.id.split('new-')[1])
  const {
    // companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsBy
  } = normalizeFields(params)

  const company = await user.get('company').fetch({ useMasterKey: true })
  const pricingModel = company ? company.get('distributor').pricingModel : null
  if (pricingModel !== 'commission') { params.endPrices = null }
  if (pricingModel) { params.monthlyMedia = null }
  const endPrices = $cleanDict(params.endPrices)
  const monthlyMedia = $cleanDict(params.monthlyMedia)

  const booking = new Booking({
    request: {
      type: 'create',
      user: user.toPointer(),
      photoIds: params.photoIds,
      photoPos: params.photoPos,
      media: params.media,
      comments: normalizeString(params.comments) || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
      motive,
      externalOrderNo,
      campaignNo,
      startsAt,
      initialDuration: parseInt(initialDuration),
      endsAt,
      autoExtendsBy,
      monthlyMedia
    },
    status: 0,
    company: user.get('company'),
    cubeIds: [cube.id],
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration: parseInt(initialDuration),
    endsAt,
    autoExtendsBy,
    endPrices,
    monthlyMedia
  })

  await checkIfCubesAreAvailable(booking)

  await validatePricing({
    company: booking.get('company'),
    cubeIds: booking.get('cubeIds'),
    endPrices: booking.get('endPrices'),
    monthlyMedia: booking.get('monthlyMedia')
  })

  return {
    booking: await booking.save(null, { useMasterKey: true }),
    message: 'Buchungsanfrage gesendet.'
  }
}, { requireUser: true })

Parse.Cloud.define('booking-change-request', async ({ params, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings')) {
    throw new Error('Unbefugter Zugriff')
  }
  const booking = await $getOrFail(Booking, params.id)
  const {
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsBy
  } = normalizeFields(params)

  const company = await booking.get('company').fetch({ useMasterKey: true })
  const pricingModel = company ? company.get('distributor').pricingModel : null
  if (pricingModel !== 'commission') { params.endPrices = null }
  if (pricingModel) { params.monthlyMedia = null }
  const endPrices = $cleanDict(params.endPrices)
  const monthlyMedia = $cleanDict(params.monthlyMedia)

  const changes = $changes(booking, {
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsBy,
    monthlyMedia,
    endPrices
  })
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen außer Bemerkung gefunden.') }
  await validatePricing({
    company: booking.get('company'),
    cubeIds: booking.get('cubeIds'),
    endPrices,
    monthlyMedia
  })

  booking.set('request', {
    type: 'change',
    user: user.toPointer(),
    changes,
    comments: normalizeString(params.comments) || undefined,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  return {
    booking: await booking.save(null, { useMasterKey: true }),
    message: 'Änderungsanfrage gesendet.'
  }
}, { requireUser: true })

Parse.Cloud.define('booking-cancel-request', async ({ params, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings')) {
    throw new Error('Unbefugter Zugriff')
  }
  const booking = await $getOrFail(Booking, params.id)
  const endsAt = normalizeDateString(params.endsAt)
  const comments = normalizeString(params.comments)

  if (booking.get('status') !== 3) {
    throw new Error('Nur laufende Buchungen können gekündigt werden.')
  }

  const changes = $cleanDict($changes(booking, { endsAt }))
  const wasCanceled = Boolean(booking.get('canceledAt'))
  if (wasCanceled && !changes) { throw new Error('Keine Änderungen') }
  const request = {
    type: wasCanceled ? 'cancel-change' : 'cancel',
    user: user.toPointer(),
    endsAt, // if the booking is extended before the request is accepted
    changes: changes || undefined,
    comments: comments || undefined,
    createdAt: new Date(),
    updatedAt: new Date()
  }
  await booking.set({ request }).save(null, { useMasterKey: true })
  return booking.get('canceledAt') ? 'Kündigungs Korrekturanfrage gesendet.' : 'Kündigungsanfrage gesendet.'
}, { requireUser: true })

Parse.Cloud.define('booking-extend-request', async ({ params, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings')) {
    throw new Error('Unbefugter Zugriff')
  }
  const booking = await $getOrFail(Booking, params.id)

  let extendBy = params.extendBy || booking.get('autoExtendsBy')
  if (!extendBy || ![3, 6, 12].includes(parseInt(extendBy))) {
    throw new Error('Verlängerungsanzahl nicht gesetzt.')
  }
  extendBy = parseInt(extendBy)

  const startsAt = booking.get('startsAt')
  const newExtendedDuration = (booking.get('extendedDuration') || 0) + extendBy
  const newTotalDuration = booking.get('initialDuration') + newExtendedDuration
  const endsAt = booking.get('endsAt')
  const newEndsAt = moment(startsAt).add(newTotalDuration, 'months').subtract(1, 'day').format('YYYY-MM-DD')
  const changes = { extendBy, endsAt: [endsAt, newEndsAt] }
  const request = {
    type: 'extend',
    user: user.toPointer(),
    changes,
    comments: params.comments || undefined,
    createdAt: new Date(),
    updatedAt: new Date()
  }
  await booking.set({ request }).save(null, { useMasterKey: true })
  return 'Verlängerungsanfrage gesendet.'
}, { requireUser: true })

Parse.Cloud.define('booking-cancel-cancel-request', async ({ params, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings')) {
    throw new Error('Unbefugter Zugriff')
  }
  const booking = await $getOrFail(Booking, params.id)
  const endsAt = normalizeDateString(params.endsAt)
  const comments = normalizeString(params.comments)
  const changes = $cleanDict($changes(booking, { endsAt }))
  const request = {
    type: 'cancel-cancel',
    user: user.toPointer(),
    changes: changes || undefined,
    comments: comments || undefined,
    createdAt: new Date(),
    updatedAt: new Date()
  }
  await booking.set({ request }).save(null, { useMasterKey: true })
  return 'Anfrage gesendet.'
}, { requireUser: true })

Parse.Cloud.define('booking-void-request', async ({ params, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings')) {
    throw new Error('Unbefugter Zugriff')
  }
  const booking = await $getOrFail(Booking, params.id)

  const request = {
    type: 'void',
    user: user.toPointer(),
    comments: normalizeString(params.comments) || undefined,
    createdAt: new Date(),
    updatedAt: new Date()
  }
  await booking.set({ request }).save(null, { useMasterKey: true })
  return 'Stornierungsanfrage gesendet'
}, { requireUser: true })

Parse.Cloud.define('booking-request-remove', async ({ params, user }) => {
  const isPartner = user.get('accType') === 'partner'
  if (!isPartner || !user.get('permissions')?.includes?.('manage-bookings')) {
    throw new Error('Unbefugter Zugriff')
  }
  const booking = await $getOrFail(Booking, params.id)
  if (booking.get('status') === 0) {
    // delete request photos that were not approved
    const requestPhotoIds = booking.get('request')?.photoIds || []
    requestPhotoIds.length && await $query('CubePhoto')
      .containedIn('objectId', requestPhotoIds)
      .notEqualTo('approved', true)
      .each(photo => photo.destroy({ useMasterKey: true }), { useMasterKey: true })
    await booking.destroy({ useMasterKey: true })
    return 'Buchungsanfrage gelöscht.'
  }
  await booking.unset('request').save(null, { useMasterKey: true })
  return 'Änderungsanfrage gelöscht.'
}, { requireUser: true })

Parse.Cloud.define('booking-request-reject', async ({ params: { id, reason }, user }) => {
  const booking = await $getOrFail(Booking, id)
  const request = booking.get('request')
  if (!request) { throw new Error('Request not found') }
  if (request.status) { throw new Error('Request already accepted or rejected') }
  request.status = 2
  request.rejectionReason = reason
  request.rejectedBy = user
  request.rejectedAt = new Date()
  request.updatedAt = new Date()
  const requestHistory = booking.get('requestHistory') || []
  requestHistory.push(request)
  booking.set({ requestHistory }).unset('request')
  request.type === 'create' && booking.set('status', -1)
  await booking.save(null, { useMasterKey: true })
  await $notify({
    user: request.user,
    identifier: 'booking-request-rejected',
    data: { bookingId: id, requestId: request.id, no: booking.get('no'), cubeId: booking.get('cube').id, type: request.type, reason }
  })
  return 'Anfrage abgelehnt.'
}, $internBookingManager)

Parse.Cloud.define('booking-request-accept', async ({ params: { id, comments }, user }) => {
  const booking = await $getOrFail(Booking, id)
  const request = booking.get('request')
  if (!request) { throw new Error('Anfrage nicht gefunden.') }
  if (request.status) { throw new Error('Diese Anfrage wurde bereits akzeptiert oder abgelehnt.') }

  // accept the cube changes
  request.photoIds?.length && await $query('CubePhoto')
    .containedIn('objectId', request.photoIds)
    .notEqualTo('approved', true)
    .each(photo => photo.set('approved', true).save(null, { useMasterKey: true }), { useMasterKey: true })
  const cube = booking.get('cube')

  if (request.photoPos?.p1 || request.photoPos?.p2) {
    request.photoPos.p1 && !cube.get('p1') && cube.set('p1', $parsify('CubePhoto', request.photoPos.p1))
    request.photoPos.p2 && !cube.get('p2') && cube.set('p2', $parsify('CubePhoto', request.photoPos.p2))
    await $saveWithEncode(cube, null, { useMasterKey: true })
  }

  if (request.media && !cube.get('vAt') && cube.get('media') !== request.media) {
    // Note: in the future when adding ht in the form make sure to check pointer has id
    // htId && cube.set('ht', $pointer('HousingType', htId))
    const ht = null
    const media = request.media
    const changes = $changes(cube, { media, ht })
    if ($cleanDict(changes)) {
      cube.set({ ht, media })
      const audit = { user, fn: 'cube-update', data: { changes } }
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
    }
  }

  request.status = 1
  request.acceptedBy = user
  request.acceptedAt = new Date()
  request.updatedAt = new Date()
  if (comments) {
    request.acceptComments = comments?.trim()
  }
  const requestHistory = booking.get('requestHistory') || []
  requestHistory.push(request)

  let message = 'Anfrage akzeptiert.'
  let audit
  let setCubeStatuses
  let endBooking
  if (request.type === 'create') {
    // create and activate booking
    await validateBookingFinalize(booking)
    // check if any special formats need to be canceled early
    await earlyCancelSpecialFormats(booking)
    booking.set({ status: 3 })
    setCubeStatuses = true
    audit = { user, fn: 'booking-create-request-accept' }
  }
  if (request.type === 'change') {
    for (const field of Object.keys(request.changes)) {
      booking.set(field, request.changes[field][1])
    }
    await checkIfCubesAreAvailable(booking)
    setCubeStatuses = true
    audit = { fn: 'booking-change-request-accept', user, data: { requestedBy: request.user, changes: request.changes } }
  }
  if (request.type === 'extend') {
    const newEndsAt = request.changes?.endsAt?.[1]
    const extendBy = request.changes.extendBy

    if (booking.get('status') !== 3) {
      throw new Error('Nur laufende Buchungen können verlängert werden.')
    }

    booking.set({
      endsAt: newEndsAt,
      extendedDuration: (booking.get('extendedDuration') || 0) + extendBy
    })
    setCubeStatuses = true
    audit = { user, fn: 'booking-extend-request-accept', data: request.changes }
  }
  if (request.type === 'end') {
    if (booking.get('status') !== 3) {
      throw new Error('Nur laufende Buchungen können beendet werden.')
    }
    if (moment(booking.get('endsAt')).isSameOrAfter(await $today(), 'day')) {
      throw new Error('Nur beendete Buchungen können als beendet markiert werden.')
    }

    booking.set({ status: booking.get('canceledAt') ? 4 : 5 })
    audit = { user, fn: 'booking-end-request-accept' }
    setCubeStatuses = true
  }
  if (request.type === 'cancel' || request.type === 'cancel-change') {
    const endsAt = request.changes?.endsAt?.[1] || request.endsAt || booking.get('endsAt')
    const cancelNotes = normalizeString(request.comments)

    if (booking.get('status') !== 3) {
      throw new Error('Nur laufende Buchungen können gekündigt werden.')
    }

    const changes = $changes(booking, { endsAt, cancelNotes })
    const wasCanceled = Boolean(booking.get('canceledAt'))
    booking.set({ endsAt, canceledAt: new Date(), cancelNotes })
    setCubeStatuses = true
    audit = { user, fn: 'booking-cancel-request-accept', data: { changes, cancelNotes } }
    if (wasCanceled) {
      audit.data.wasCanceled = true
    }
    if (moment(endsAt).isBefore(await $today(), 'day')) {
      endBooking = true
    }
  }
  if (request.type === 'cancel-cancel') {
    const endsAt = request.changes?.endsAt[1]
    const changes = $changes(booking, { endsAt })
    booking.set({ endsAt, canceledAt: null, cancelNotes: null })
    setCubeStatuses = true
    audit = { user, fn: 'booking-cancel-cancel-request-accept', data: { changes } }
    message += 'Kündigung zurückgerufen.'
    if (booking.get('status') > 3) {
      booking.set('status', 3)
      booking.set('canceledAt', null)
      message += ' Buchung status auf Aktiv gestellt. Bitte überprüfen Sie den Status der Buchung.'
    }
  }
  if (request.type === 'void') {
    const cancelNotes = normalizeString(request.comments)
    booking.set({
      status: -1,
      voidedAt: new Date(),
      canceledAt: null,
      cancelNotes
    })
    setCubeStatuses = true
    audit = { user, fn: 'booking-void-request-accept', data: { cancelNotes } }
  }

  await booking.unset('request').set({ requestHistory }).save(null, { useMasterKey: true, context: { audit, setCubeStatuses } })
  endBooking && await Parse.Cloud.run('booking-end', { id: booking.id }, { useMasterKey: true })
  request.acceptComments && await $notify({
    user: request.user,
    identifier: 'booking-request-accept-comments',
    data: { bookingId: id, requestId: request.id, no: booking.get('no'), cubeId: booking.get('cube').id, type: request.type, comments: request.acceptComments }
  })
  return message
}, $internBookingManager)
