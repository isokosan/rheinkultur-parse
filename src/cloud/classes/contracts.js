const { sum } = require('lodash')
const { normalizeDateString, normalizeString, contracts: { UNSET_NULL_FIELDS, normalizeFields } } = require('@/schema/normalizers')
const { round2, round5, priceString } = require('@/utils')
const { getNewNo, getPeriodTotal, checkIfCubesAreAvailable, setCubeOrderStatus } = require('@/shared')
const { generateContract } = require('@/docs')
const sendMail = require('@/services/email')
const { getInvoiceTotals } = require('./invoices')
const { getPredictedCubeGradualPrice } = require('./gradual-price-maps')

const Contract = Parse.Object.extend('Contract')

Parse.Cloud.beforeSave(Contract, async ({ object: contract }) => {
  contract.isNew() && !contract.get('no') && contract.set({ no: await getNewNo('V' + moment(await $today()).format('YY') + '-', Contract, 'no') })
  UNSET_NULL_FIELDS.forEach(field => !contract.get(field) && contract.unset(field))

  if (contract.get('pricingModel') === 'gradual') {
    if (!contract.get('gradualPriceMap')) {
      const company = contract.get('company')
      await company.fetch({ useMasterKey: true })
      const { gradualPriceMapId } = company.get('contractDefaults') || {}
      contract.set('gradualPriceMap', await $getOrFail('GradualPriceMap', gradualPriceMapId))
    }
  }

  if (contract.get('agency')) {
    if (contract.get('agency').id === contract.get('company').id) {
      throw new Error('Kunde und Agentur können nicht gleich sein.')
    }
    if (!contract.get('commission') && !contract.get('commissions')) {
      throw new Error('Bitte tragen Sie die Provision ein.')
    }
  }

  contract.set('totalDuration', (contract.get('initialDuration') || 0) + (contract.get('extendedDuration') || 0))

  // cubes
  !contract.get('cubeIds') && contract.set('cubeIds', [])
  contract.set('cubeCount', (contract.get('cubeIds') || []).length)
})

Parse.Cloud.afterSave(Contract, async ({ object: contract, context: { audit, setCubeStatuses, recalculatePlannedInvoices } }) => {
  setCubeStatuses && await setCubeOrderStatus(contract)
  if (recalculatePlannedInvoices) {
    Parse.Cloud.run(
      'contract-update-planned-invoices',
      { id: contract.id },
      { useMasterKey: true }
    )
  }
  audit && $audit(contract, audit)
})

Parse.Cloud.beforeFind(Contract, ({ query }) => {
  query._include.includes('all') && query.include([
    'company',
    'address',
    'companyPerson',
    'invoiceAddress',
    'agency',
    'agencyPerson',
    'production',
    'docs',
    'tags',
    'gradual'
  ])
})

Parse.Cloud.afterFind(Contract, async ({ objects: contracts, query }) => {
  const year = moment(await $today()).format('YYYY')
  for (const contract of contracts) {
    // get computed property willExtend
    const willExtend = contract.get('autoExtendsAt') && !contract.get('canceledAt')
    contract.set('willExtend', willExtend)

    if (query._include.includes('gradual') && contract.get('pricingModel') === 'gradual' && contract.get('status') < 2) {
      contract.set('gradual', await getPredictedCubeGradualPrice(contract, contract.get('startsAt')))
    }
    if (query._include.includes('production')) {
      contract.set('production', await $query('Production').equalTo('contract', contract).first({ useMasterKey: true }))
    }
    contract.set('commissionRate', getContractCommissionForYear(contract, year))
  }
  return contracts
})

Parse.Cloud.afterDelete(Contract, $deleteAudits)

function getContractCommissionForYear (contract, year) {
  if (contract.get('commissions')) {
    return contract.get('commissions')[year] || contract.get('commission')
  }
  return contract.get('commission')
}

function getInvoiceLineItems ({ production, media }) {
  if (!media) {
    // Should not occur
    throw new Error('Invoice without media!')
  }
  if (!production) {
    return [{
      name: 'Dauerwerbung Media',
      price: round2(media.total || 0)
    }]
  }
  if (production.installments) {
    // Production does not exist
    return [{
      name: 'Dauerwerbung Media & Servicekosten',
      price: round2((media.total || 0) + (production?.total || 0))
    }]
  }
  return [
    {
      name: 'Produktion und Montage',
      price: round2(production.total || 0)
    },
    {
      name: 'Dauerwerbung Media',
      price: round2(media.total || 0)
    }
  ].filter(({ price }) => price)
}

// Note: we do not consider early cancellations here since this is only used before contract finalization
async function getInvoicesPreview (contract) {
  await contract.fetchWithInclude('production', { useMasterKey: true })

  const invoicesPreview = []
  const contractStart = moment(contract.get('startsAt'))
  const contractEnd = moment(contract.get('endsAt'))
  const billingCycle = contract.get('billingCycle') || 12

  // INITIALIZE PRODUCTION DATA
  const billing = contract.get('production')?.get('billing') || 0
  const installments = billing > 1 ? billing : 0
  let remainingInstallments = installments
  const monthlies = contract.get('production')?.get('monthlies') || {}
  const productionSum = contract.get('production')?.get('total')
  let monthlyProductionTotal = 0
  if (installments) {
    for (const price of Object.values(monthlies || {})) {
      monthlyProductionTotal += price
    }
  }

  let periodStart = contractStart.clone()
  let firstInvoice = true
  let paidInstallments = 0

  while (true) {
    if (periodStart.isAfter(contractEnd)) {
      break
    }
    const addMonths = billingCycle - (periodStart.month() % billingCycle)
    const nextPeriodStart = periodStart.clone().add(addMonths, 'months').set('date', 1)
    // if the periodStart carry reached the contractEnd break
    const periodEnd = contractEnd.isBetween(periodStart, nextPeriodStart, 'day', '[)')
      ? contractEnd.clone()
      : nextPeriodStart.clone().subtract(1, 'days')

    let invoiceDate = periodStart.clone().subtract(2, 'weeks').format('YYYY-MM-DD')
    if (periodStart.isAfter(invoiceDate, 'year')) {
      invoiceDate = periodStart.clone().set('date', 2).format('YYYY-MM-DD')
    }
    // if invoicing period is at the end
    if (contract.get('invoicingAt') === 'end') {
      invoiceDate = periodEnd.clone().add(1, 'day').format('YYYY-MM-DD')
      if (periodEnd.isBefore(invoiceDate, 'year')) {
        invoiceDate = moment(invoiceDate).set('date', 2).format('YYYY-MM-DD')
      }
    }

    if (moment(invoiceDate).isBefore($wawiStart, 'day')) {
      periodStart = periodEnd.clone().add(1, 'days')
      continue
    }

    const invoice = {
      status: 1,
      date: invoiceDate,
      company: contract.get('company'),
      address: contract.get('invoiceAddress') || contract.get('address'),
      paymentType: contract.get('paymentType'),
      dueDays: contract.get('dueDays'),
      companyPerson: contract.get('companyPerson'),
      contract,
      tags: contract.get('tags'),
      periodStart: periodStart.format('YYYY-MM-DD'),
      periodEnd: periodEnd.format('YYYY-MM-DD'),
      cubeCount: contract.get('cubeCount'),
      agency: contract.get('agency')
    }

    const mediaItems = []
    let mediaTotal = 0
    let monthlyTotal = 0

    if (contract.get('pricingModel') === 'gradual') {
      const { gradualCount, gradualPrice } = await getPredictedCubeGradualPrice(contract, periodStart)
      invoice.gradualCount = gradualCount
      invoice.gradualPrice = gradualPrice
    }

    for (const cubeId of contract.get('cubeIds')) {
      const monthly = invoice.gradualPrice || contract.get('monthlyMedia')?.[cubeId]
      monthlyTotal += monthly
      const { months, total } = getPeriodTotal(periodStart, periodEnd, monthly)
      mediaTotal += total
      mediaItems.push({ cubeId, orderId: `C:${contract.id}`, months, monthly, total })
    }
    invoice.media = {
      items: mediaItems,
      monthlyTotal: round2(monthlyTotal),
      total: round2(mediaTotal)
    }

    // only for production, if first non-installment production invoice or an installment invoice
    if (billing && ((!installments && firstInvoice) || remainingInstallments > 0)) {
      const production = contract.get('production')
      let periodInstallments = remainingInstallments < contract.get('billingCycle')
        ? remainingInstallments
        : moment(periodEnd).add(1, 'days').diff(periodStart, 'months', true)
      let productionTotal
      if (monthlyProductionTotal && paidInstallments < installments) {
        if (paidInstallments + periodInstallments > installments) {
          periodInstallments = round5(installments - paidInstallments)
        }
        productionTotal = round5(periodInstallments * monthlyProductionTotal)
      }
      if (!installments) {
        productionTotal = productionSum
      }

      const productionItems = []
      for (const cubeId of Object.keys(production.get('printPackages'))) {
        const total = production.get('totals')?.[cubeId] || 0
        productionItems.push({
          cubeId,
          orderId: `C:${contract.id}`,
          no: production.get('printPackages')?.[cubeId]?.no,
          monthly: monthlies?.[cubeId],
          total: installments ? round2(monthlies[cubeId] * periodInstallments) : total
        })
      }
      invoice.production = {
        id: production.id,
        items: productionItems,
        monthlyTotal: installments
          ? round2(monthlyProductionTotal)
          : undefined,
        total: round2(productionTotal)
      }
      if (billing && installments) {
        paidInstallments = round5(paidInstallments)
        periodInstallments = round5(periodInstallments)
        invoice.production.installments = installments
        invoice.production.paidInstallments = paidInstallments
        invoice.production.periodInstallments = periodInstallments
        paidInstallments = round5(paidInstallments + periodInstallments)
        remainingInstallments = round5(installments - paidInstallments)
        invoice.production.remainingInstallments = remainingInstallments
      }
    }

    invoice.lineItems = getInvoiceLineItems({ production: invoice.production, media: invoice.media })

    invoicesPreview.push(invoice)
    firstInvoice = false

    if (periodEnd.format('YYYY-MM-DD') >= contractEnd.format('YYYY-MM-DD')) {
      break
    }
    periodStart = periodEnd.clone().add(1, 'days')
  }
  return invoicesPreview
    .map((invoice) => {
      const { netTotal, taxTotal, total } = getInvoiceTotals(invoice.lineItems, invoice.date)
      invoice.netTotal = netTotal
      invoice.taxTotal = taxTotal
      invoice.total = total
      // commissions
      if (invoice.media?.total && invoice.agency) {
        invoice.commissionRate = getContractCommissionForYear(contract, moment(invoice.date).year())
        const net = round2((invoice.commissionRate || 0) * invoice.media.total / 100)
        invoice.commission = { net }
      }
      return invoice
    })
    .filter(({ total }) => Boolean(total))
}

function validateProduction (production, cubeIds) {
  const printPackages = production.get('printPackages') || {}
  for (const cubeId of cubeIds) {
    if (!(cubeId in printPackages) || !printPackages[cubeId]) {
      throw new Error('Sie müssen für alle CityCubes ein Belegungspaket auswählen.')
    }
  }
  return true
}

async function validateContractFinalize (contract, skipCubeValidations) {
  if (contract.get('status') > 2) {
    throw new Error('Vertrag schon finalisiert.')
  }
  // check if contract has cubeIds
  const cubeIds = contract.get('cubeIds') || []
  if (!cubeIds.length) {
    throw new Error('Sie müssen mindestens einen CityCube hinzugefügt haben, um den Vertrag zu finalisieren.')
  }

  // check if all cubes are available
  await checkIfCubesAreAvailable(cubeIds, contract.get('startsAt'))

  // validate production
  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  production && validateProduction(production, cubeIds)

  // check if all cubes have been assigned a monthly price, if the pricing model is not gradual
  if (contract.get('pricingModel') !== 'gradual') {
    const monthlyMedia = contract.get('monthlyMedia') || {}
    for (const cubeId of cubeIds) {
      if (!(cubeId in monthlyMedia)) {
        throw new Error('Sie müssen für alle Werbemedien einen monatlichen Preis eingeben.')
      }
    }
    // Make sure the pricingModel is zero if total media sum is 0€
    if (contract.get('pricingModel') !== 'zero' && !sum(Object.values(contract.get('monthlyMedia') || {}))) {
      throw new Error('Bitte wählen Sie das Preismodell "0€", wenn alle Medienpreise 0€ betragen.')
    }
  }
}

Parse.Cloud.define('contract-invoices-preview', async ({ params: { id: contractId } }) => {
  const contract = await $getOrFail(Contract, contractId)
  if (contract.get('status') > 2) {
    throw new Error('Can only preview unfinalized contract invoices.')
  }
  if (!contract.get('startsAt') || !contract.get('endsAt')) {
    return []
  }
  return getInvoicesPreview(contract)
}, { requireUser: true })

/**
 * Generates a contract with cubeids
 */
Parse.Cloud.define('contract-generate', async ({ params, user }) => {
  const {
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    cubeIds
  } = normalizeFields(params)
  const contract = new Contract({
    status: 2,
    motive,
    externalOrderNo,
    campaignNo,
    cubeIds,
    responsibles: user ? [user] : undefined
  })
  companyId && contract.set({ company: await $getOrFail('Company', companyId) })
  companyPersonId && contract.set({ companyPerson: await $getOrFail('Person', companyPersonId) })
  contract.set({ tags: contract.get('company').get('tags') })
  contract.set({ billingCycle: contract.get('company')?.get('billingCycle') || 12 })
  const audit = { user, fn: 'contract-generate' }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

/**
 * Creates a contract with the basic settings.
 * Cubes and amounts are handled later
 */
Parse.Cloud.define('contract-create', async ({ params, user, master, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const {
    companyId,
    addressId,
    companyPersonId,
    invoiceAddressId,
    invoicingAt,
    paymentType,
    dueDays,
    motive,
    externalOrderNo,
    campaignNo,
    agencyId,
    agencyPersonId,
    commission,
    commissions,
    startsAt,
    initialDuration,
    billingCycle,
    endsAt,
    noticePeriod,
    autoExtendsAt,
    autoExtendsBy,
    pricingModel
  } = normalizeFields(params)

  const company = await $getOrFail('Company', companyId)
  const contract = new Contract({
    no: master ? params.no : undefined,
    status: 2,
    company,
    address: await $getOrFail('Address', addressId),
    companyPerson: companyPersonId ? await $getOrFail('Person', companyPersonId) : undefined,
    invoiceAddress: invoiceAddressId ? await $getOrFail('Address', invoiceAddressId) : undefined,
    invoicingAt,
    paymentType,
    dueDays,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    billingCycle,
    endsAt,
    pricingModel,
    noticePeriod,
    autoExtendsAt,
    autoExtendsBy,
    agency: agencyId ? await $getOrFail('Company', agencyId) : undefined,
    agencyPerson: agencyPersonId ? await $getOrFail('Person', agencyPersonId) : undefined,
    commission,
    commissions,
    responsibles: user ? [$pointer(Parse.User, user.id)] : undefined,
    tags: company.get('tags')
  })

  const audit = { user, fn: 'contract-create' }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('contract-update-cubes', async ({ params: { id: contractId, ...params }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  if (contract.get('status') > 2) {
    throw new Error('Finalisierte Verträge können nicht mehr geändert werden.')
  }
  const { cubeIds } = normalizeFields(params)
  $cubeLimit(cubeIds.length)

  const cubeChanges = $cubeChanges(contract, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  contract.set({ cubeIds })
  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  if (production) {
    await Parse.Cloud.run('production-update-cubes', { id: production.id, cubeIds }, { useMasterKey: true })
  }
  const audit = { user, fn: 'contract-update', data: { cubeChanges } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('contract-update', async ({ params: { id: contractId, monthlyMedia, production, ...params }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const {
    cubeIds,
    companyId,
    addressId,
    companyPersonId,
    invoiceAddressId,
    invoicingAt,
    paymentType,
    dueDays,
    motive,
    externalOrderNo,
    campaignNo,
    agencyId,
    agencyPersonId,
    commission,
    commissions,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsAt,
    autoExtendsBy,
    pricingModel,
    billingCycle,
    invoiceDescription
  } = normalizeFields(params)

  const contract = await $getOrFail(Contract, contractId, ['all'])
  if (contract.get('status') > 2) {
    throw new Error('Finalisierte Verträge können nicht mehr geändert werden.')
  }
  $cubeLimit(cubeIds.length)

  const cubeChanges = $cubeChanges(contract, cubeIds)
  cubeChanges && contract.set({ cubeIds })

  // clean monthly prices for missing cubes in form
  if (pricingModel === 'gradual') {
    monthlyMedia = null
  } else {
    for (const cubeId of Object.keys(monthlyMedia || {})) {
      if (!cubeIds.includes(cubeId)) {
        delete monthlyMedia[cubeId]
      }
    }
  }
  monthlyMedia = monthlyMedia && Object.keys(monthlyMedia).length ? monthlyMedia : null

  const changes = $changes(contract, {
    invoicingAt,
    paymentType,
    dueDays,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    pricingModel,
    billingCycle,
    invoiceDescription,
    monthlyMedia,
    noticePeriod,
    autoExtendsBy
  })
  contract.set({
    invoicingAt,
    paymentType,
    dueDays,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    billingCycle,
    endsAt,
    pricingModel,
    invoiceDescription,
    noticePeriod,
    autoExtendsBy,
    autoExtendsAt,
    monthlyMedia
  })

  if (companyId !== contract.get('company')?.id) {
    changes.companyId = [contract.get('company')?.id, companyId]
    const company = await $getOrFail('Company', companyId, ['tags'])
    contract.set({ company })
    // override company tags
    company.get('tags') ? contract.set('tags', company.get('tags')) : contract.unset('tags')
  }
  if (addressId !== contract.get('address')?.id) {
    const address = addressId ? await $getOrFail('Address', addressId) : null
    changes.address = [contract.get('address')?.get('name'), address?.get('name')]
    contract.set({ address })
  }
  if (companyPersonId !== contract.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [contract.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    contract.set({ companyPerson })
  }

  if (invoiceAddressId !== contract.get('invoiceAddress')?.id) {
    const invoiceAddress = invoiceAddressId ? await $getOrFail('Address', invoiceAddressId) : null
    changes.invoiceAddress = [contract.get('invoiceAddress')?.get('name'), invoiceAddress?.get('name')]
    contract.set({ invoiceAddress })
  }

  if (agencyId !== contract.get('agency')?.id) {
    changes.agencyId = [contract.get('agency')?.id, agencyId]
    contract.set('agency', agencyId ? await $getOrFail('Company', agencyId) : null)
  }
  if (agencyPersonId !== contract.get('agencyPerson')?.id) {
    const agencyPerson = agencyPersonId ? await $getOrFail('Person', agencyPersonId) : null
    changes.agencyPerson = [contract.get('agencyPerson')?.get('fullName'), agencyPerson?.get('fullName')]
    contract.set({ agencyPerson })
  }
  const commissionChanges = $changes(contract, { commission, commissions })
  changes.commission = commissionChanges.commission
  changes.commissions = commissionChanges.commissions
  commission ? contract.set({ commission }) : contract.unset('commission')
  commissions ? contract.set({ commissions }) : contract.unset('commissions')

  contract.get('status') === 1 && contract.set('status', 0)

  let productionChanges = {}
  const existingProduction = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  if (production) {
    const { billing, printPackages, interestRate, prices, extras, totals } = production
    const cubeIds = contract.get('cubeIds') || []
    // clean print packages for missing cubes in contract
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
    production.set({ contract, billing, printPackages, interestRate: null, prices: null, extras: null, totals: null })
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

  const audit = { user, fn: 'contract-update', data: { changes, cubeChanges, productionChanges } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('offer-mark-as-sent', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  contract.set({ status: 1 })
  const audit = { user, fn: 'offer-mark-as-sent' }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('offer-mark-as-unsent', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  contract.set({ status: 0 })
  const audit = { user, fn: 'offer-mark-as-unsent' }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('contract-finalize-preview', async ({ params: { id: contractId } }) => {
  const contract = await $getOrFail(Contract, contractId)
  await validateContractFinalize(contract)
  // TODO: Report cubes in other bookings/contracts
  return {
    otherContracts: [],
    otherBookings: []
  }
}, { requireUser: true })

Parse.Cloud.define('contract-finalize', async ({ params: { id: contractId }, user, context: { seedAsId, skipCubeValidations, setCubeStatuses, recalculateGradualInvoices } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const contract = await $getOrFail(Contract, contractId)
  await validateContractFinalize(contract, skipCubeValidations)

  // generate invoices
  const Invoice = Parse.Object.extend('Invoice')
  await contract.get('company').fetchWithInclude('company', { useMasterKey: true })
  for (const item of await getInvoicesPreview(contract)) {
    const invoice = new Invoice(item)
    await invoice.save(null, { useMasterKey: true, context: { audit: { fn: 'invoice-generate' } } })
  }

  // set contract status to active
  contract.set({ status: 3 })
  const audit = { user, fn: 'contract-finalize' }

  return contract.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: setCubeStatuses !== false } })
}, { requireUser: true })

// TOAUDIT: regenerate changes
Parse.Cloud.define('contract-update-planned-invoices', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  const plannedInvoices = await $query('Invoice').equalTo('contract', contract).equalTo('status', 1).find({ useMasterKey: true })
  const earlyCancellations = contract.get('earlyCancellations') || {}
  let i = 0
  for (const invoice of plannedInvoices) {
    const { periodStart, periodEnd } = invoice.attributes
    if (contract.get('pricingModel') === 'gradual') {
      const { gradualCount, gradualPrice } = await getPredictedCubeGradualPrice(contract, periodStart)
      invoice.set('gradualCount', gradualCount)
      invoice.set('gradualPrice', gradualPrice)
    }

    const mediaItems = []
    let monthlyTotal = 0
    let mediaTotal = 0

    for (const cubeId of contract.get('cubeIds')) {
      const monthly = invoice.get('gradualPrice') || contract.get('monthlyMedia')?.[cubeId]
      const cubeCanceledAt = earlyCancellations[cubeId]
        ? moment(earlyCancellations[cubeId])
        : null
      // if cube is canceledEarly, and the early cancelation is before periodStart, skip
      if (cubeCanceledAt && cubeCanceledAt.isBefore(periodStart)) {
        continue
      }
      monthlyTotal += monthly

      const { total, months } = getPeriodTotal(periodStart, cubeCanceledAt && cubeCanceledAt.isBefore(periodEnd) ? cubeCanceledAt : periodEnd, monthly)
      mediaTotal += total
      const mediaItem = {
        cubeId,
        orderId: `C:${contract.id}`,
        months,
        monthly,
        total
      }
      if (cubeCanceledAt && cubeCanceledAt.isBefore(periodEnd)) {
        mediaItem.periodEnd = cubeCanceledAt.format('YYYY-MM-DD')
      }
      mediaItems.push(mediaItem)
    }
    invoice.set('media', {
      items: mediaItems,
      monthlyTotal: round2(monthlyTotal),
      total: round2(mediaTotal)
    })

    invoice.set('lineItems', getInvoiceLineItems({ production: invoice.get('production'), media: invoice.get('media') }))
    const audit = { user, fn: 'invoice-regenerate' }
    // TOAUDIT: changes
    await invoice.save(null, { useMasterKey: true, context: { rewriteIntroduction: true, audit } })
    i++
  }
  return i
}, { requireUser: true })

// deletes and recreates planned invoices
// TODO: add extended planned invoices as well
Parse.Cloud.define('contract-regenerate-planned-invoices', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId, ['company'])
  const plannedInvoices = await $query('Invoice').equalTo('contract', contract).equalTo('status', 1).find({ useMasterKey: true })
  for (const invoice of plannedInvoices) {
    await invoice.destroy({ useMasterKey: true })
  }
  // generate invoices
  const Invoice = Parse.Object.extend('Invoice')
  for (const item of await getInvoicesPreview(contract)) {
    consola.info(item.date, item.total)
    const sameDateInvoice = await $query(Invoice).equalTo('contract', contract).equalTo('date', item.date).first({ useMasterKey: true })
    if (sameDateInvoice) {
      consola.warn(sameDateInvoice.id)
      continue
    }
    consola.success('saving invoice')
    const invoice = new Invoice(item)
    await invoice.save(null, { useMasterKey: true, context: { audit: { fn: 'invoice-generate' } } })
  }
}, { requireUser: true })

// recreates canceled invoice
Parse.Cloud.define('contract-regenerate-canceled-invoice', async ({ params: { id: invoiceId }, user }) => {
  const canceledInvoice = await $getOrFail('Invoice', invoiceId)
  const contract = canceledInvoice.get('contract')
  await contract.fetchWithInclude(['address', 'invoiceAddress'], { useMasterKey: true })
  const Invoice = Parse.Object.extend('Invoice')
  // TODO: add extended planned invoices as well
  const found = await getInvoicesPreview(contract)
    .then(items => items.filter(({ date }) => date === canceledInvoice.get('date')))
  if (!found || found.length > 1) {
    throw new Error('Can\'t find invoice or found multiple invoices.')
  }
  consola.info(found[0])
  const invoice = new Invoice(found[0])
  return invoice.save(null, { useMasterKey: true, context: { audit: { user, fn: 'invoice-regenerate-from-canceled', data: { invoiceNo: canceledInvoice.get('lexNo') } } } })
}, { requireUser: true })

Parse.Cloud.define('contract-generate-cancellation-credit-note', async ({ params: { id: contractId, cancellations }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  // check if there are issued invoices that fall under the cancellation dates
  const issuedInvoices = await Parse.Query.or(...Object.values(cancellations)
    .map(date => $query('Invoice').greaterThan('periodEnd', date))
  ).equalTo('contract', contract).equalTo('status', 2).find({ useMasterKey: true })
  if (!issuedInvoices.length) {
    return
  }
  const invoiceAddress = issuedInvoices[0].get('address')
  if (issuedInvoices.find(invoice => invoice.get('address')?.id !== invoiceAddress.id)) {
    // TOTRANSLATE
    throw new Error('Es wurden verschiedene Rechnungsadressen verwendet. Schreiben Sie die Gutschrift manuell.')
  }

  // create a credit note
  const cubes = []
  for (const cubeId of Object.keys(cancellations)) {
    const cubeEnd = cancellations[cubeId]
    for (const invoice of issuedInvoices) {
      const mediaItems = invoice.get('media').items
      const mediaItem = mediaItems.find(item => item.cubeId === cubeId)
      if (!mediaItem) {
        continue
      }
      const periodStart = invoice.get('periodStart')
      const periodEnd = mediaItem.periodEnd || invoice.get('periodEnd')
      if (moment(cubeEnd).isBefore(periodStart)) {
        // cube canceled within the invoice period
        cubes.push({
          cubeId,
          invoiceNo: invoice.get('lexNo'),
          periodEnd,
          cubeEnd,
          diff: mediaItem.total
        })
        continue
      }
      if (moment(cubeEnd).isBefore(periodEnd)) {
        const { monthly, total } = mediaItem
        const { total: newTotal } = getPeriodTotal(periodStart, periodEnd, monthly)
        // cube canceled within the invoice period
        cubes.push({
          cubeId,
          invoiceNo: invoice.get('lexNo'),
          periodEnd,
          cubeEnd,
          diff: round2(total - newTotal)
        })
      }
    }
  }

  const invoices = {}
  for (const cube of cubes) {
    if (!invoices[cube.invoiceNo]) {
      invoices[cube.invoiceNo] = 0
    }
    invoices[cube.invoiceNo] += cube.diff
  }

  const creditNote = $parsify('CreditNote')
  creditNote.set({
    company: contract.get('company'),
    address: invoiceAddress,
    companyPerson: contract.get('companyPerson'),
    contract,
    status: 0,
    date: await $today(),
    lineItems: [{
      name: 'CityCubes entfallen von Vertrag',
      price: round2(sum(cubes.map((cube) => cube.diff)))
    }],
    reason: [
      'Folgende CityCubes entfallen von Vertrag:',
      Object.keys(cancellations).map(cubeId => `${cubeId}: ${moment(cancellations[cubeId]).format('DD.MM.YYYY')}`).join(', '),
      'Folgende Rechnungen wurde gutgeschrieben:',
      Object.keys(invoices).map((invoiceNo) => `${invoiceNo}: ${priceString(invoices[invoiceNo])}€`).join(', ')
    ].join('\n')
  })
  const audit = { user, fn: 'credit-note-generate' }
  return creditNote.save(null, { useMasterKey: true, context: { audit } })
}, { requireMaster: true })

/**
 * Contracts are extended by one year.
 * When a contract is extended
 *   the contract end date is updated
 *   extended years is incremented
 *   new upcoming invoices are generated and current ones are updated if necessary
 */
// email: true (the email defined in invoice address will be used) | string (the custom email will be used) | false (no email will be send)
Parse.Cloud.define('contract-extend', async ({ params: { id: contractId, email }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const contract = await $getOrFail(Contract, contractId, ['address', 'invoiceAddress'])
  if (contract.get('status') !== 3) {
    throw new Error('Nur laufende Verträge können verlängert werden.')
  }
  if (contract.get('canceledAt')) {
    throw new Error('Gekündigte Verträge können nicht verlängert werden.')
  }
  const autoExtendsBy = contract.get('autoExtendsBy')
  if (!autoExtendsBy) {
    throw new Error('Verlängerungsanzahl nicht gesetzt.')
  }

  const billingCycle = contract.get('billingCycle') || 12

  const endsAt = contract.get('endsAt')
  const newEndsAt = moment(endsAt).add(autoExtendsBy, 'months')

  contract.set({
    endsAt: newEndsAt.format('YYYY-MM-DD'),
    autoExtendsAt: newEndsAt.clone().subtract(contract.get('noticePeriod'), 'months').format('YYYY-MM-DD'),
    extendedDuration: (contract.get('extendedDuration') || 0) + autoExtendsBy
  })
  let message = 'Vertrag wurde verlängert.'

  if (email === true) {
    const address = contract.get('invoiceAddress') || contract.get('address')
    email = address.get('email')
  }
  email && await Parse.Cloud.run('contract-extend-send-mail', { id: contract.id, email }, { useMasterKey: true })
    .then(() => { message += ` Email an ${email} gesendet.` })

  const audit = { user, fn: 'contract-extend', data: { autoExtendsBy, endsAt: [endsAt, contract.get('endsAt')] } }
  await contract.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })

  if (contract.get('pricingModel') !== 'zero') {
    const newInvoices = []
    // Generate new periodic invoices for one year
    let periodStart = moment(endsAt).add(1, 'day')
    while (true) {
      const addMonths = billingCycle - (periodStart.month() % billingCycle)
      const nextPeriodStart = periodStart.clone().add(addMonths, 'months').set('date', 1)
      // if the periodStart carry reached the contractEnd break
      const periodEnd = newEndsAt.isBetween(periodStart, nextPeriodStart)
        ? newEndsAt.clone()
        : nextPeriodStart.clone().subtract(1, 'days')

      let invoiceDate = periodStart.clone().subtract(2, 'weeks').format('YYYY-MM-DD')
      if (periodStart.isAfter(invoiceDate, 'year')) {
        invoiceDate = periodStart.clone().set('date', 2).format('YYYY-MM-DD')
      }
      // if invoicing period is at the end
      if (contract.get('invoicingAt') === 'end') {
        invoiceDate = periodEnd.clone().add(1, 'day').format('YYYY-MM-DD')
        if (periodEnd.isBefore(invoiceDate, 'year')) {
          invoiceDate = moment(invoiceDate).set('date', 2).format('YYYY-MM-DD')
        }
      }
      const invoice = {
        status: 1,
        date: invoiceDate,
        company: contract.get('company'),
        address: contract.get('invoiceAddress') || contract.get('address'),
        companyPerson: contract.get('companyPerson'),
        paymentType: contract.get('paymentType'),
        dueDays: contract.get('dueDays'),
        contract,
        tags: contract.get('tags'),
        periodStart: periodStart.format('YYYY-MM-DD'),
        periodEnd: periodEnd.format('YYYY-MM-DD'),
        cubeCount: contract.get('cubeCount'),
        agency: contract.get('agency')
      }

      const mediaItems = []
      let monthlyTotal = 0
      let mediaTotal = 0

      if (contract.get('pricingModel') === 'gradual') {
        const { gradualCount, gradualPrice } = await getPredictedCubeGradualPrice(contract, periodStart)
        invoice.gradualCount = gradualCount
        invoice.gradualPrice = gradualPrice
      }

      const earlyCancellations = contract.get('earlyCancellations') || {}
      for (const cubeId of contract.get('cubeIds')) {
        const monthly = invoice.gradualPrice || contract.get('monthlyMedia')?.[cubeId]
        monthlyTotal += monthly
        const cubeCanceledAt = earlyCancellations[cubeId]
          ? moment(earlyCancellations[cubeId])
          : null
        // if cube is canceledEarly, and the early cancelation is before periodStart, skip
        if (cubeCanceledAt && cubeCanceledAt.isBefore(periodStart)) {
          continue
        }

        const { total, months } = getPeriodTotal(periodStart, cubeCanceledAt && cubeCanceledAt.isBefore(periodEnd) ? cubeCanceledAt : periodEnd, monthly)
        mediaTotal += total

        const mediaItem = {
          cubeId,
          orderId: `C:${contract.id}`,
          months,
          monthly,
          total
        }
        if (cubeCanceledAt && cubeCanceledAt.isBefore(periodEnd)) {
          mediaItem.periodEnd = cubeCanceledAt.format('YYYY-MM-DD')
        }
        mediaItems.push(mediaItem)
      }
      invoice.media = {
        items: mediaItems,
        monthlyTotal: round2(monthlyTotal),
        total: round2(mediaTotal)
      }

      if (invoice.agency) {
        invoice.commissionRate = getContractCommissionForYear(contract, periodStart.year())
      }

      invoice.lineItems = getInvoiceLineItems({ media: invoice.media })

      Boolean(mediaTotal) && newInvoices.push(invoice)
      if (periodEnd.format('YYYY-MM-DD') >= newEndsAt.format('YYYY-MM-DD')) {
        break
      }
      periodStart = periodEnd.clone().add(1, 'days')
    }

    await Parse.Object.saveAll(
      newInvoices.map(item => new (Parse.Object.extend('Invoice'))(item)),
      { useMasterKey: true, context: { audit: { fn: 'invoice-generate' } } }
    )
    message += ` ${newInvoices.length} neue Rechnungen generiert.`
  }
  return message
}, { requireUser: true })

Parse.Cloud.define('contract-extend-send-mail', async ({ params: { id: contractId, email }, user }) => {
  if (!email) {
    throw new Error(`Bad email ${email}`)
  }
  const contract = await $getOrFail(Contract, contractId, ['address', 'invoiceAddress'])
  if (contract.get('status') !== 3) {
    throw new Error('Can\'t send inactive contract extend mails')
  }
  const attachments = [{
    filename: `${contract.get('no')} Verlängerung.pdf`,
    contentType: 'application/pdf',
    href: process.env.EXPORTS_SERVER_URL + '/contract-extend-pdf/' + contract.id
  }]
  const template = 'contract-extend'
  const mailStatus = await sendMail({
    to: email,
    subject: `Vertragsverlängerung - ${contract.get('no')}`,
    template,
    variables: {
      contract: contract.toJSON()
    },
    attachments
  })
  const audit = { fn: 'send-email', user, data: { template, mailStatus } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

/**
 * When a contract is canceled on a given date
 *   the cubes will become available when endsAt date is reached
 *   the selected upcoming invoices will be auto-discarded
 */
Parse.Cloud.define('contract-cancel', async ({
  params: {
    id: contractId,
    endsAt,
    disassemblyStart,
    discardInvoiceIds,
    notes: cancelNotes
  }, user
}) => {
  const contract = await $getOrFail(Contract, contractId, ['production'])
  endsAt = normalizeDateString(endsAt)
  disassemblyStart = normalizeDateString(disassemblyStart)
  cancelNotes = normalizeString(cancelNotes)

  if (contract.get('status') !== 3) {
    throw new Error('Nur laufende Verträge können gekündigt werden.')
  }

  // delete upcoming invoices, if any specified
  const invoices = await $query('Invoice')
    .equalTo('contract', contract)
    .equalTo('status', 1)
    .containedIn('objectId', discardInvoiceIds)
    .limit(discardInvoiceIds.length)
    .find({ useMasterKey: true })
  const discardedInvoices = {}
  const invoiceAudit = { user, fn: 'invoice-discard', data: { reason: 'Vertrag gekündigt.' } }
  for (const invoice of invoices) {
    const discarded = await Parse.Cloud.run(
      'invoice-discard',
      { id: invoice.id },
      { useMasterKey: true, context: { audit: invoiceAudit } }
    )
    discardedInvoices[discarded.id] = discarded.get('date')
  }
  const changes = $changes(contract, { endsAt, cancelNotes })
  contract.set({ endsAt, canceledAt: new Date(), cancelNotes })
  if (contract.get('production') && contract.get('production').get('disassemblyStart') !== disassemblyStart) {
    changes.disassemblyStart = [contract.get('production').get('disassemblyStart'), disassemblyStart]
  }
  const audit = { user, fn: 'contract-cancel', data: { changes } }
  if (contract.get('canceledAt')) {
    audit.data.wasCanceled = true
  }
  if (Object.keys(discardedInvoices).length) {
    audit.data.discardedInvoices = discardedInvoices
  }
  await contract.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  if (contract.get('production') && disassemblyStart) {
    await contract.get('production')
      .set({ disassemblyStart })
      .save(null, { useMasterKey: true })
  }
  return contract
}, { requireUser: true })

/**
 * When a contract is ended
 *   the contract status is set to "Ausgelaufen or Gekündikt"
 *   the werbemedien inside the contract are freed via cube beforesave
 */
Parse.Cloud.define('contract-end', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  if (contract.get('status') !== 3) {
    throw new Error('Nur laufende Verträge können beendet werden.')
  }
  if (moment(contract.get('endsAt')).isSameOrAfter(await $today(), 'day')) {
    throw new Error('Nur beendete Verträge können als beendet markiert werden.')
  }
  contract.set({ status: contract.get('canceledAt') ? 4 : 5 })
  const audit = { user, fn: 'contract-end' }
  return contract.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, { requireUser: true })

/**
 * When a contract invoice address is changed, the specified planned invoices are updated
 */
Parse.Cloud.define('contract-change-invoice-address', async ({
  params: {
    id: contractId,
    invoiceIds,
    ...params
  }, user
}) => {
  const contract = await $getOrFail(Contract, contractId, ['address', 'invoiceAddress'])
  if (contract.get('status') !== 3) {
    throw new Error('Only active contracts can be changed')
  }

  const invoiceAddressId = normalizeFields(params).invoiceAddressId || contract.get('address').id

  const changes = {}
  if (invoiceAddressId === contract.get('invoiceAddress')?.id) {
    throw new Error('Keine Änderungen')
  }
  const invoiceAddress = invoiceAddressId ? await $getOrFail('Address', invoiceAddressId) : null
  changes.invoiceAddress = [contract.get('invoiceAddress')?.get('name'), invoiceAddress?.get('name')]
  contract.set({ invoiceAddress })

  const invoices = await $query('Invoice')
    .equalTo('contract', contract)
    .equalTo('status', 1)
    .include('address')
    .containedIn('objectId', invoiceIds)
    .find({ useMasterKey: true })

  for (const invoice of invoices) {
    const invoiceChanges = {}
    if (invoiceAddressId !== invoice.get('address')?.id) {
      const address = invoiceAddressId ? await $getOrFail('Address', invoiceAddressId) : null
      invoiceChanges.address = [invoice.get('address')?.get('name'), address?.get('name')]
      address ? invoice.set({ address }) : invoice.unset('address')
    }
    if (!Object.keys(invoiceChanges).length) {
      continue
    }
    const invoiceAudit = { user, fn: 'invoice-update', data: { changes: invoiceChanges } }
    await invoice.save(null, { useMasterKey: true, context: { audit: invoiceAudit } })
  }
  const audit = { user, fn: 'contract-update', data: { changes } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

/**
 * When a contract commission is changed, the specified planned invoices are updated
 */
Parse.Cloud.define('contract-change-commission', async ({
  params: {
    id: contractId,
    hasCommission,
    invoiceIds,
    ...params
  }, user
}) => {
  const contract = await $getOrFail(Contract, contractId, ['agency', 'agencyPerson'])
  if (contract.get('status') !== 3) {
    throw new Error('Only active contracts can be changed')
  }
  if (!hasCommission) {
    params.agencyId = null
  }
  const { agencyId, agencyPersonId, commission, commissions } = normalizeFields(params)

  const changes = {}
  if (agencyId !== contract.get('agency')?.id) {
    changes.agencyId = [contract.get('agency')?.id, agencyId]
    contract.set('agency', agencyId ? await $getOrFail('Company', agencyId) : null)
  }
  if (agencyPersonId !== contract.get('agencyPerson')?.id) {
    const agencyPerson = agencyPersonId ? await $getOrFail('Person', agencyPersonId) : null
    changes.agencyPerson = [contract.get('agencyPerson')?.get('fullName'), agencyPerson?.get('fullName')]
    contract.set({ agencyPerson })
  }
  const commissionChanges = $changes(contract, { commission, commissions })
  changes.commission = commissionChanges.commission
  changes.commissions = commissionChanges.commissions
  contract.set({ commission, commissions })

  const invoices = await $query('Invoice')
    .equalTo('contract', contract)
    .equalTo('status', 1)
    .containedIn('objectId', invoiceIds)
    .find({ useMasterKey: true })

  for (const invoice of invoices) {
    const commissionRate = getContractCommissionForYear(contract, moment(invoice.get('date')).year())
    const invoiceChanges = $changes(invoice, { commissionRate })
    if (agencyId !== invoice.get('agency')?.id) {
      invoiceChanges.agencyId = [invoice.get('agency')?.id, agencyId]
    }
    if (!Object.keys(invoiceChanges).length) {
      continue
    }
    const invoiceAudit = { user, fn: 'invoice-update', data: { changes: invoiceChanges } }
    invoice.set({
      agency: agencyId ? await $getOrFail('Company', agencyId) : null,
      commissionRate
    })
    await invoice.save(null, { useMasterKey: true, context: { audit: invoiceAudit } })
  }
  const audit = { user, fn: 'contract-update', data: { changes } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('contract-toggle-auto-invoice-emails', async ({ params: { id: contractId }, user }) => {
  const contract = await $query(Contract).get(contractId, { useMasterKey: true })
  const toggle = !contract.get('skipInvoiceEmails')
  contract.set('skipInvoiceEmails', toggle)
  const audit = { user, fn: 'contract-toggle-auto-invoice-emails', data: { send: !contract.get('skipInvoiceEmails') } }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  return contract.get('skipInvoiceEmails')
    ? 'Belege werden nicht automatisch per E-Mail verschickt.'
    : 'Belege werden automatisch per E-Mail verschickt.'
}, { requireUser: true })

Parse.Cloud.define('contract-generate-doc', async ({ params: { id: contractId }, user }) => {
  const contract = await $query(Contract).get(contractId, { useMasterKey: true })
  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  production && validateProduction(production, contract.get('cubeIds'))
  const wasGenerated = Boolean(contract.get('driveFileId'))
  contract.set({ driveFileId: await generateContract(contract) })
  const audit = { user, fn: 'contract-generate-doc', data: { wasGenerated } }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  return contract.get('driveFileId')
}, { requireUser: true })

Parse.Cloud.define('contract-remove', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  if (contract.get('status') !== 0 && contract.get('status') !== 2) {
    throw new Error('Nur Verträge im Entwurfsstatus können gelöscht werden!')
  }
  return contract.destroy({ useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('contract-set-late-start', async ({ params: { id: contractId, date, diffInDays, periodTotal }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  const beforeLateStart = contract.get('lateStart')
  const creditNote = beforeLateStart?.creditNote
    ? await beforeLateStart?.creditNote.fetch({ useMasterKey: true })
    : undefined
  const lateStart = { date, diffInDays, periodTotal, creditNote }
  contract.set({ lateStart })
  const audit = { user, fn: 'contract-set-late-start', data: { changes: { date: [beforeLateStart?.date, date] } } }
  let message = beforeLateStart ? 'Verspäteter Vertragsbeginn geändert.' : 'Verspäteter Vertragsbeginn gesetzt.'
  if (creditNote && creditNote.get('status') === 1) {
    const creditNoteAudit = { user, fn: 'credit-note-regenerate' }
    creditNote.set('periodEnd', moment(date).subtract(1, 'day').format('YYYY-MM-DD'))
    creditNote.set('lineItems', [{
      name: `Verzögerte Montage am ${moment(date).format('DD.MM.YYYY')}`,
      price: periodTotal
    }])
    await creditNote.save(null, { useMasterKey: true, context: { audit: creditNoteAudit, rewriteIntroduction: true } })
    message += ' Gutschrift neu generiert.'
  }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  return message
}, { requireUser: true })

Parse.Cloud.define('contract-unset-late-start', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  const lateStart = contract.get('lateStart')
  const creditNote = lateStart?.creditNote
    ? await lateStart?.creditNote.fetch({ useMasterKey: true })
    : undefined
  if (creditNote && creditNote.get('status') > 1) {
    throw new Error('Gutschrift bereits abgeschlossen')
  }
  contract.unset('lateStart')
  const audit = { user, fn: 'contract-set-late-start', data: { changes: { date: [lateStart?.date, null] } } }
  let message = 'Verspäteter Vertragsbeginn gelöscht.'
  if (creditNote) {
    await creditNote.destroy({ useMasterKey: true })
    message += ' Gutchrift gelöscht.'
  }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  return message
}, { requireUser: true })

// FOR LEASE START DATE CREDIT NOTE CALCULATION
Parse.Cloud.define('contract-get-period-total', async ({ params: { id: contractId, startsAt, endsAt } }) => {
  const contract = await $getOrFail(Contract, contractId)
  let monthlyTotal = sum(Object.values(contract.get('monthlyMedia') || {}))
  if (contract.get('pricingModel') === 'gradual') {
    const { gradualPrice } = await getPredictedCubeGradualPrice(contract, startsAt)
    monthlyTotal = gradualPrice * contract.get('cubeCount')
  }
  return getPeriodTotal(startsAt, endsAt, monthlyTotal).total
}, { requireUser: true })

Parse.Cloud.define('contract-generate-late-start-credit-note', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  if (!contract.get('lateStart')) {
    throw new Error('Vertrag hat keine Verspätung')
  }
  if (contract.get('lateStart').creditNote) {
    consola.info(contract.get('lateStart').creditNote)
    throw new Error('Es wurde bereits eine Gutschrift erstellt')
  }
  const creditNote = $parsify('CreditNote')
  const lateStart = contract.get('lateStart')
  creditNote.set({
    status: 1,
    company: contract.get('company'),
    address: contract.get('invoiceAddress') || contract.get('address'),
    companyPerson: contract.get('companyPerson'),
    contract,
    date: await $today(),
    periodStart: contract.get('startsAt'),
    periodEnd: moment(lateStart.date).subtract(1, 'day').format('YYYY-MM-DD'),
    lineItems: [{
      name: `Verzögerte Montage am ${moment(lateStart.date).format('DD.MM.YYYY')}`,
      price: lateStart.periodTotal
    }]
  })
  const company = creditNote.get('company')
  await company.fetchWithInclude('tags', { useMasterKey: true })
  creditNote.set({ tags: company.get('tags') })
  const audit = { user, fn: 'credit-note-generate' }
  await creditNote.save(null, { useMasterKey: true, context: { audit } })
  lateStart.creditNote = $parsify('CreditNote', creditNote.id)
  contract.set({ lateStart })
  await contract.save(null, { useMasterKey: true })
  return 'Gutschrift generiert'
}, { requireUser: true })
