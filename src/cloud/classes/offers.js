const { offers: { UNSET_NULL_FIELDS, normalizeFields } } = require('@/schema/normalizers')
const { round2 } = require('@/utils')
const { getNewNo, getLastRemovedCubeIds, getCommissionForYear } = require('@/shared')

const Offer = Parse.Object.extend('Offer')

Parse.Cloud.beforeSave(Offer, async ({ object: offer }) => {
  offer.isNew() && !offer.get('no') && offer.set({ no: await getNewNo('A' + moment(await $today()).format('YY') + '-', Offer, 'no') })
  UNSET_NULL_FIELDS.forEach(field => !offer.get(field) && offer.unset(field))
  offer.set('status', offer.get('contract') ? 3 : 0)

  offer.get('autoExtendsBy') && offer.get('endsAt')
    ? offer.set('autoExtendsAt', moment(offer.get('endsAt')).subtract(offer.get('noticePeriod') || 0, 'months').format('YYYY-MM-DD'))
    : offer.unset('autoExtendsAt')

  const cubeIds = offer.get('cubeIds') || []
  cubeIds.sort()
  offer.set('cubeIds', cubeIds).set('cubeCount', cubeIds.length)
  if (offer.get('earlyCancellations')) {
    const earlyCancellations = $cleanDict(offer.get('earlyCancellations'), cubeIds)
    earlyCancellations ? offer.set('earlyCancellations', earlyCancellations) : offer.unset('earlyCancellations')
  }
})

Parse.Cloud.afterSave(Offer, async ({ object: offer, context: { audit } }) => {
  audit && $audit(offer, audit)
})

Parse.Cloud.beforeFind(Offer, ({ query }) => {
  query._include.includes('all') && query.include([
    'contract',
    'company',
    'companyPerson',
    // 'agency',
    // 'agencyPerson',
    'production',
    'docs',
    'tags',
    'gradual',
    'lastRemovedCubeIds'
  ])
})

Parse.Cloud.afterFind(Offer, async ({ objects: offers, query }) => {
  const year = moment(await $today()).format('YYYY')
  for (const offer of offers) {
    // get computed property willExtend
    const willExtend = offer.get('autoExtendsBy') && !offer.get('canceledAt') && !offer.get('voidedAt')
    offer.set('willExtend', willExtend)
    if (query._include.includes('production')) {
      offer.set('production', await $query('Production').equalTo('offer', offer).first({ useMasterKey: true }))
    }
    // TOOFFER: check the right statuses
    if (query._include.includes('lastRemovedCubeIds') && offer.get('status') >= 0 && offer.get('status') <= 2.1) {
      offer.set('lastRemovedCubeIds', await getLastRemovedCubeIds('Contract', offer.id))
    }
    offer.set('commissionRate', getCommissionForYear(offer, year))
  }
  return offers
})

Parse.Cloud.beforeDelete(Offer, async ({ object: offer }) => {
  if (offer.get('status') !== 0) {
    throw new Error('Nur Angebote im Entwurfsstatus können gelöscht werden!')
  }
  if (await $query('Contract').equalTo('offer', offer).count({ useMasterKey: true })) {
    throw new Error('Es existieren Verträge zu diesem Angebot.')
  }
})

Parse.Cloud.afterDelete(Offer, async ({ object: offer }) => {
  const production = await $query('Production').equalTo('offer', offer).first({ useMasterKey: true })
  production && !production.get('contract') && await production.destroy({ useMasterKey: true })
  $deleteAudits({ object: offer })
})

Parse.Cloud.define('offer-create', async ({ params: { requirements, additionalServices, ...params }, user, master }) => {
  const {
    companyId,
    // addressId,
    companyPersonId,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy
  } = normalizeFields(params)
  const offer = new Offer({
    no: master ? params.no : undefined,
    status: 0,
    company: companyId ? await $getOrFail('Company', companyId) : undefined,
    // address: addressId ? await $getOrFail('Address', addressId) : undefined,
    companyPerson: companyPersonId ? await $getOrFail('Person', companyPersonId) : undefined,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    requirements,
    additionalServices,
    responsibles: user ? [$pointer(Parse.User, user.id)] : undefined
  })
  const audit = { user, fn: 'offer-create' }
  return offer.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('offer-update-cubes', async ({ params: { id: offerId, ...params }, user }) => {
  const offer = await $getOrFail(Offer, offerId, 'company')
  if (offer.get('status') >= 3) {
    throw new Error('CityCubes von abgeschossene Angebote können nicht mehr geändert werden.')
  }
  const { cubeIds } = normalizeFields(params)
  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(offer, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  offer.set({ cubeIds })
  const monthlyMedia = offer.get('monthlyMedia') || {}
  for (const cubeId of cubeIds) {
    monthlyMedia[cubeId] = monthlyMedia[cubeId] || 0
  }
  offer.set({ monthlyMedia })

  const production = await $query('Production').equalTo('offer', offer).first({ useMasterKey: true })
  production && production.save(null, { useMasterKey: true })

  const audit = { user, fn: 'offer-update', data: { cubeChanges } }
  return offer.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('offer-update', async ({ params: { id: offerId, requirements, additionalServices, monthlyMedia, production, ...params }, user }) => {
  const {
    cubeIds,
    companyId,
    // addressId,
    companyPersonId,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy
  } = normalizeFields(params)

  const offer = await $getOrFail(Offer, offerId, ['all'])
  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(offer, cubeIds)
  cubeChanges && offer.set({ cubeIds })
  monthlyMedia = $cleanDict(monthlyMedia, cubeIds)
  const changes = $changes(offer, {
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    monthlyMedia,
    requirements,
    additionalServices
  })
  offer.set({
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    monthlyMedia,
    requirements,
    additionalServices
  })

  if (companyId && companyId !== offer.get('company')?.id) {
    offer.set('company', await $getOrFail('Company', companyId))
    changes.companyId = [offer.get('company').id, companyId]
  }
  if (companyId !== offer.get('company')?.id) {
    const company = companyId ? await $getOrFail('Company', companyId) : null
    changes.company = [offer.get('company')?.id || null, companyId]
    company ? offer.set({ company }) : offer.unset('company')
    // override company tags
    company.get('tags') ? offer.set('tags', company.get('tags')) : offer.unset('tags')
  }
  if (companyPersonId !== offer.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [offer.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    companyPerson ? offer.set({ companyPerson }) : offer.unset('companyPerson')
  }

  let productionChanges = {}
  const existingProduction = await $query('Production').equalTo('offer', offer).first({ useMasterKey: true })
  if (production) {
    const { billing, printPackages, interestRate, prices, extras, totals } = production
    const cubeIds = offer.get('cubeIds') || []
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
    production.set({ offer, billing, printPackages, interestRate: null, prices: null, extras: null, totals: null })
    if (billing) {
      const installments = billing > 1 ? billing : null
      let productionTotal = 0
      production.set({ prices, extras, totals })
      const monthlies = {}
      for (const cubeId of Object.keys(printPackages)) {
        const cubeTotal = totals?.[cubeId] || 0
        if (installments) {
          monthlies[cubeId] = Math.floor(cubeTotal / installments)
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

  const audit = { user, fn: 'offer-update', data: { changes, cubeChanges, productionChanges } }
  return offer.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('offer-fetch', async ({ params: { key } }) => {
  const [className, objectId] = key.split('-')
  const order = await $getOrFail(className, objectId, ['all', 'responsibles'])
  return order.toJSON()
})
