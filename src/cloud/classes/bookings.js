const { normalizeDateString, normalizeString, bookings: { UNSET_NULL_FIELDS, normalizeFields } } = require('@/schema/normalizers')

const { round2 } = require('@/utils')
const { getNewNo, checkIfCubesAreAvailable, setCubeOrderStatuses } = require('@/shared')

const Booking = Parse.Object.extend('Booking')

Parse.Cloud.beforeSave(Booking, async ({ object: booking }) => {
  booking.isNew() && !booking.get('no') && booking.set({ no: await getNewNo('B' + moment(await $today()).format('YY') + '-', Booking, 'no') })
  UNSET_NULL_FIELDS.forEach(field => !booking.get(field) && booking.unset(field))

  const company = booking?.get('company')
  if (company) {
    await company.fetch({ useMasterKey: true })
    if (!company.get('distributor')) {
      throw new Error('Buchungen können nur bei Vertriebspartner angelegt werden.')
    }
  }

  booking.set('totalDuration', (booking.get('initialDuration') || 0) + (booking.get('extendedDuration') || 0))

  // cubes
  !booking.get('cubeIds') && booking.set('cubeIds', [])
  booking.set('cubeCount', (booking.get('cubeIds') || []).length)
})

Parse.Cloud.afterSave(Booking, async ({ object: booking, context: { audit, setCubeStatuses } }) => {
  setCubeStatuses && await setCubeOrderStatuses(booking)
  audit && $audit(booking, audit)
})

Parse.Cloud.beforeFind(Booking, ({ query }) => {
  query._include.includes('all') && query.include([
    'company',
    'companyPerson',
    'production',
    'docs'
  ])
})

Parse.Cloud.afterFind(Booking, async ({ objects: bookings, query }) => {
  for (const booking of bookings) {
    // get computed property willExtend
    const willExtend = booking.get('autoExtendsAt') && !booking.get('canceledAt')
    booking.set('willExtend', willExtend)

    if (query._include.includes('production')) {
      booking.set('production', await $query('Production').equalTo('booking', booking).first({ useMasterKey: true }))
    }
  }
  return bookings
})

Parse.Cloud.afterDelete(Booking, $deleteAudits)

async function validateBookingActivate (booking) {
  if (booking.get('status') > 2) {
    throw new Error('Buchung schon aktiv.')
  }

  // check if booking has cubeIds
  const cubeIds = booking.get('cubeIds') || []
  if (!cubeIds.length) {
    // TOTRANSLATE
    throw new Error('Booking needs werbemittel to be activated')
  }

  // check if all cubes are available
  await checkIfCubesAreAvailable(cubeIds, booking.get('startsAt'))

  // validate production
  const production = await $query('Production').equalTo('booking', booking).first({ useMasterKey: true })
  if (production) {
    const printPackages = production.get('printPackages')
    for (const cubeId of cubeIds) {
      if (!(cubeId in printPackages) || !printPackages[cubeId]) {
        throw new Error('Sie müssen für alle Werbemedien ein Belegungspaket auswählen.')
      }
    }
  }

  // check pricing assignments if required
  const company = booking.get('company')
  if (company) {
    await company.fetch({ useMasterKey: true })
    const pricingModel = company.get('distributor').pricingModel
    if (pricingModel === 'commission') {
      const endPrices = booking.get('endPrices')
      for (const cubeId of cubeIds) {
        if (!endPrices?.[cubeId]) {
          throw new Error('Sie müssen für alle Werbemedien ein Endkunde Preis auswählen.')
        }
      }
    }
    if (pricingModel === 'zero') {
      const monthlyMedia = booking.get('monthlyMedia')
      for (const cubeId of cubeIds) {
        if (monthlyMedia?.[cubeId]) {
          throw new Error('Alle medien muss 0€ sein.')
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
        // TOTRANSLATE
        throw new Error(noMediaCubes.length > 1 ? `Cubes ${noMediaCubes.map(c => c.id).join(', ')} do not have their media set!` : `Cube ${noMediaCubes[0].id} does not have media type set!`)
      }
    }
    if (!pricingModel) {
      const monthlyMedia = booking.get('monthlyMedia')
      for (const cubeId of cubeIds) {
        if (!monthlyMedia?.[cubeId]) {
          throw new Error('Sie müssen für alle Werbemedien ein RK Netto Preis auswählen.')
        }
      }
    }
  }
  if (!company) {
    const monthlyMedia = booking.get('monthlyMedia')
    for (const cubeId of cubeIds) {
      if (monthlyMedia?.[cubeId]) {
        throw new Error('Alle medien muss 0€ sein.')
      }
    }
  }
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
}, { requireUser: true })

/**
 * Creates a booking with the basic settings.
 * Cubes and amounts are handled later
 */
Parse.Cloud.define('booking-create', async ({ params, user, master, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const {
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsAt,
    autoExtendsBy
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
    autoExtendsAt,
    autoExtendsBy,
    responsibles: user ? [user] : undefined
  })
  companyId && booking.set({ company: await $getOrFail('Company', companyId) })
  companyPersonId && booking.set({ companyPerson: await $getOrFail('Person', companyPersonId) })

  booking.get('company') && booking.set({ tags: booking.get('company').get('tags') })

  const audit = { user, fn: 'booking-create' }
  return booking.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

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
  if (production) {
    await Parse.Cloud.run('production-update-cubes', { id: production.id, cubeIds }, { useMasterKey: true })
  }
  const audit = { user, fn: 'booking-update', data: { cubeChanges } }
  return booking.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('booking-update', async ({
  params: {
    id: bookingId,
    endPrices,
    monthlyMedia,
    production,
    ...params
  }, user, context: { seedAsId }
}) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

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
    autoExtendsAt,
    autoExtendsBy
  } = normalizeFields(params)

  const booking = await $getOrFail(Booking, bookingId)
  $cubeLimit(cubeIds.length)

  const cubeChanges = $cubeChanges(booking, cubeIds)
  cubeChanges && booking.set({ cubeIds })

  const company = companyId ? await $getOrFail('Company', companyId) : null
  const pricingModel = company ? company.get('distributor').pricingModel : null
  if (pricingModel !== 'commission') {
    endPrices = null
  }
  if (pricingModel) {
    monthlyMedia = null
  }
  endPrices = endPrices && Object.keys(endPrices).length ? endPrices : null
  monthlyMedia = monthlyMedia && Object.keys(monthlyMedia).length ? monthlyMedia : null

  const changes = $changes(booking, {
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    autoExtendsAt,
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
    autoExtendsAt,
    autoExtendsBy,
    monthlyMedia,
    endPrices
  })

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
}, { requireUser: true })

Parse.Cloud.define('booking-activate', async ({ params: { id: bookingId }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }
  const booking = await $getOrFail(Booking, bookingId)
  await validateBookingActivate(booking)
  booking.set({ status: 3 })
  const audit = { user, fn: 'booking-activate' }
  return booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, { requireUser: true })

Parse.Cloud.define('booking-set-cube-statuses', async ({ params: { id: bookingId } }) => {
  const booking = await $getOrFail(Booking, bookingId)
  return booking.save(null, { useMasterKey: true, context: { setCubeStatuses: true } })
}, { requireUser: true })

Parse.Cloud.define('booking-deactivate', async ({ params: { id: bookingId }, user }) => {
  const booking = await $getOrFail(Booking, bookingId)
  booking.set({ status: 2.1 })
  const audit = { user, fn: 'booking-deactivate' }
  return booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, { requireUser: true })

/**
 * Bookings are extended by auto extend duration
 * When a booking is extended
 *   the booking end date is updated
 *   extended years is incremented
 */
Parse.Cloud.define('booking-extend', async ({ params: { id: bookingId }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const booking = await $getOrFail(Booking, bookingId)
  if (booking.get('status') !== 3) {
    throw new Error('Nur laufende Buchungen können verlängert werden.')
  }
  const autoExtendsBy = booking.get('autoExtendsBy')
  if (!autoExtendsBy) {
    throw new Error('Verlängerungsanzahl nicht gesetzt.')
  }

  const endsAt = booking.get('endsAt')
  const newEndsAt = moment(endsAt).add(autoExtendsBy, 'months')
  booking.set({
    endsAt: newEndsAt.format('YYYY-MM-DD'),
    autoExtendsAt: newEndsAt.clone().format('YYYY-MM-DD'),
    extendedDuration: (booking.get('extendedDuration') || 0) + autoExtendsBy
  })
  const audit = { user, fn: 'booking-extend', data: { autoExtendsBy, endsAt: [endsAt, booking.get('endsAt')] } }
  return booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, { requireUser: true })

/**
 * When a booking is canceled on a given date
 *   the cubes will become available when endsAt date is reached
 */
Parse.Cloud.define('booking-cancel', async ({
  params: {
    id: bookingId,
    endsAt,
    notes: cancelNotes
  }, user
}) => {
  endsAt = normalizeDateString(endsAt)
  cancelNotes = normalizeString(cancelNotes)

  const booking = await $getOrFail(Booking, bookingId)
  if (booking.get('status') !== 3) {
    throw new Error('Nur laufende Buchungen können gekündigt werden.')
  }

  const changes = $changes(booking, { endsAt, cancelNotes })
  const wasCanceled = Boolean(booking.get('canceledAt'))
  booking.set({ endsAt, canceledAt: new Date(), cancelNotes })
  const audit = { user, fn: 'booking-cancel', data: { changes } }
  if (wasCanceled) {
    audit.data.wasCanceled = true
  }
  await booking.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  if (moment(endsAt).isBefore(await $today(), 'day')) {
    return Parse.Cloud.run('booking-end', { id: booking.id }, { useMasterKey: true })
  }
}, { requireUser: true })

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
}, { requireUser: true })

Parse.Cloud.define('booking-remove', async ({ params: { id: bookingId } }) => {
  const booking = await $getOrFail(Booking, bookingId)
  if (booking.get('status') !== 0 && booking.get('status') !== 2) {
    throw new Error('Nur Buchungen im Entwurfsstatus können gelöscht werden!')
  }
  return booking.destroy({ useMasterKey: true })
}, { requireUser: true })

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
}, { requireUser: true })
