const { sum, isEqual } = require('lodash')
const { contracts: { UNSET_NULL_FIELDS, normalizeFields } } = require('@/schema/normalizers')
const { round2, round5, priceString } = require('@/utils')
const { getNewNo, getDocumentTotals, getPeriodTotal, validateOrderFinalize, getCommissionForYear, setOrderCubeStatuses, getLastRemovedCubeIds, earlyCancelSpecialFormats } = require('@/shared')
const { generateContract } = require('@/docs')
const { sendInfoMail } = require('@/services/email')
const { getPredictedCubeGradualPrice } = require('./gradual-price-maps')
const { addressAudit } = require('@/cloud/classes/addresses')

const Contract = Parse.Object.extend('Contract')

Parse.Cloud.beforeSave(Contract, async ({ object: contract }) => {
  contract.isNew() && !contract.get('no') && contract.set({ no: await getNewNo('V' + moment(await $today()).format('YY') + '-', Contract, 'no') })
  UNSET_NULL_FIELDS.forEach(field => !contract.get(field) && contract.unset(field))

  if (contract.get('pricingModel') === 'gradual' && !contract.get('gradualPriceMap')) {
    const company = contract.get('company')
    await company.fetch({ useMasterKey: true })
    const { gradualPriceMapId } = company.get('contractDefaults') || {}
    contract.set('gradualPriceMap', await $getOrFail('GradualPriceMap', gradualPriceMapId))
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
  const canceled = Boolean(contract.get('canceledAt') || contract.get('voidedAt'))
  !canceled && contract.set('autoExtendsAt', contract.get('autoExtendsBy') ? moment(contract.get('endsAt')).subtract(contract.get('noticePeriod') || 0, 'months').format('YYYY-MM-DD') : null)

  // cubes
  const cubeIds = contract.get('cubeIds') || []
  if (cubeIds.length > CUBE_LIMIT) {
    throw new Error(`Es können maximal ${CUBE_LIMIT} CityCubes pro Auftrag hinzugefügt werden.`)
  }
  cubeIds.sort()
  contract.set('cubeIds', cubeIds).set('cubeCount', cubeIds.length)
  if (contract.get('earlyCancellations')) {
    const earlyCancellations = $cleanDict(contract.get('earlyCancellations'), cubeIds)
    earlyCancellations ? contract.set('earlyCancellations', earlyCancellations) : contract.unset('earlyCancellations')
  }
})

Parse.Cloud.afterSave(Contract, async ({ object: contract, context: { audit, setCubeStatuses, recalculatePlannedInvoices } }) => {
  if (setCubeStatuses) {
    await contract.fetch({ useMasterKey: true })
    await setOrderCubeStatuses(contract)
  }
  audit && $audit(contract, audit)
  recalculatePlannedInvoices && Parse.Cloud.run(
    'contract-update-planned-invoices',
    { id: contract.id },
    { useMasterKey: true }
  )
})

Parse.Cloud.beforeFind(Contract, ({ query }) => {
  query._include.includes('all') && query.include([
    'offer',
    'company',
    'address',
    'companyPerson',
    'invoiceAddress',
    'cubeData',
    'agency',
    'agencyPerson',
    'production',
    'docs',
    'tags',
    'gradual',
    'lastRemovedCubeIds'
  ])
  !query._include.includes('cubeData') && query.exclude('cubeData')
})

Parse.Cloud.afterFind(Contract, async ({ objects: contracts, query }) => {
  const year = moment(await $today()).format('YYYY')
  for (const contract of contracts) {
    // get computed property willExtend
    const willExtend = contract.get('autoExtendsBy') && !contract.get('canceledAt') && !contract.get('voidedAt')
    contract.set('willExtend', willExtend)

    if (query._include.includes('gradual') && contract.get('pricingModel') === 'gradual' && contract.get('status') < 2) {
      contract.set('gradual', await getPredictedCubeGradualPrice(contract, contract.get('startsAt')))
    }
    if (query._include.includes('production')) {
      contract.set('production', await $query('Production').equalTo('contract', contract).first({ useMasterKey: true }))
    }
    if (query._include.includes('lastRemovedCubeIds') && contract.get('status') >= 0 && contract.get('status') <= 2.1) {
      contract.set('lastRemovedCubeIds', await getLastRemovedCubeIds('Contract', contract.id))
    }
    contract.set('commissionRate', getCommissionForYear(contract, year))
  }
  return contracts
})

Parse.Cloud.beforeDelete(Contract, async ({ object: contract }) => {
  if (contract.get('status') !== 0 && contract.get('status') !== 2) {
    throw new Error('Nur Aufträge im Entwurfsstatus können gelöscht werden!')
  }
  if (await $query('Invoice').equalTo('contract', contract).count({ useMasterKey: true })) {
    throw new Error('Es existieren noch Rechnungen zu diesem Auftrag.')
  }
  if (await $query('CreditNote').equalTo('contract', contract).count({ useMasterKey: true })) {
    throw new Error('Es existieren noch Gutschriften zu diesem Auftrag.')
  }
})

Parse.Cloud.afterDelete(Contract, async ({ object: contract }) => {
  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  if (production) {
    production.get('offer')
      ? await production.unset('contract').save(null, { useMasterKey: true })
      : await production.destroy({ useMasterKey: true })
  }
  const offer = await $query('Offer').equalTo('contract', contract).first({ useMasterKey: true })
  if (offer) {
    await offer.unset('contract').save(null, { useMasterKey: true, context: { audit: { fn: 'contract-delete' } } })
  }
  $deleteAudits({ object: contract })
})

function getInvoiceLineItems ({ production, media }) {
  if (!media) {
    // Should not occur
    throw new Error('Invoice without media in invoice getLineItems!')
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

function getPeriodEnd ({ periodStart, billingCycle, contractStart, contractEnd, generating, nextInvoice }) {
  periodStart = moment(periodStart)
  contractEnd = moment(contractEnd)
  const addMonths = billingCycle - (periodStart.month() % billingCycle)
  const nextPeriodStart = periodStart.clone().add(addMonths, 'months').set('date', 1)
  // if generating for the first time
  if (generating) {
    return nextPeriodStart.isBefore(contractEnd) ? nextPeriodStart.subtract(1, 'day') : contractEnd
  }
  // if next invoice start is defined, use one day before for end
  if (nextInvoice && contractEnd.isSameOrAfter(nextInvoice.get('periodStart'))) {
    return moment(nextInvoice.get('periodStart')).subtract(1, 'day')
  }
  // if contract ends in this year use that as contract cut
  if (periodStart.year() === contractEnd.year()) {
    if (contractEnd.isBetween(periodStart, nextPeriodStart, 'day', '[)')) {
      return contractEnd
    }
  } else {
    const contractCut = moment(contractStart).year(periodStart.year()).subtract(1, 'day')
    if (contractCut.isBetween(periodStart, nextPeriodStart, 'day', '[)')) {
      return contractCut
    }
  }
  return nextPeriodStart.clone().subtract(1, 'day')
}

// Note: we do not consider early cancellations here since this is only used before contract finalization
async function getInvoicesPreview (contract) {
  await contract.fetchWithInclude(['address', 'invoiceAddress', 'production', 'company'], { useMasterKey: true })

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
    const periodEnd = getPeriodEnd({ periodStart, billingCycle, contractStart, contractEnd, generating: true })

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

    // if invoice date is before wawi start skip generating invoice
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
      const { netTotal, taxTotal, total } = getDocumentTotals(invoice.address.get('lex').allowTaxFreeInvoices, invoice.lineItems, invoice.date)
      invoice.netTotal = netTotal
      invoice.taxTotal = taxTotal
      invoice.total = total
      // commissions
      if (invoice.media?.total && invoice.agency) {
        invoice.commissionRate = getCommissionForYear(contract, moment(invoice.date).year())
        if (!invoice.commissionRate) {
          delete invoice.agency
          return invoice
        }
        const net = round2((invoice.commissionRate || 0) * invoice.media.total / 100)
        invoice.commission = { net }
      }
      return invoice
    })
    .filter(({ total }) => Boolean(total))
}

// WIP: Replacement for getInvoicesPreview with early cancellations
Parse.Cloud.define('contracts-wip-calculate-invoices', async ({ params: { contractId } }) => {
  const contract = await $getOrFail(Contract, contractId, ['address', 'invoiceAddress', 'production', 'company'])

  const invoicesPreview = []

  const contractStart = moment(contract.get('startsAt'))
  const contractEnd = moment(contract.get('endsAt'))
  const billingCycle = contract.get('billingCycle') || 12
  const earlyCancellations = contract.get('earlyCancellations') || {}

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
    const periodEnd = getPeriodEnd({ periodStart, billingCycle, contractStart, contractEnd, generating: true })

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

    // if invoice date is before wawi start skip generating invoice
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
      // if cube completely canceled skip
      if (earlyCancellations[cubeId] === true) { continue }

      // if cube is canceledEarly, and the early cancelation is before periodStart, skip
      const cubeCanceledAt = earlyCancellations[cubeId] ? moment(earlyCancellations[cubeId]) : null
      if (cubeCanceledAt && cubeCanceledAt.isBefore(periodStart)) {
        continue
      }

      const monthly = invoice.gradualPrice || contract.get('monthlyMedia')?.[cubeId]
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
      const { netTotal, taxTotal, total } = getDocumentTotals(invoice.address.get('lex').allowTaxFreeInvoices, invoice.lineItems, invoice.date)
      invoice.netTotal = netTotal
      invoice.taxTotal = taxTotal
      invoice.total = total
      // commissions
      if (invoice.media?.total && invoice.agency) {
        invoice.commissionRate = getCommissionForYear(contract, moment(invoice.date).year())
        if (!invoice.commissionRate) {
          delete invoice.agency
          return invoice
        }
        const net = round2((invoice.commissionRate || 0) * invoice.media.total / 100)
        invoice.commission = { net }
      }
      return invoice
    })
    .filter(({ total }) => Boolean(total))
}, { requireMaster: true })
// WIP: To check if there are missing periods in invoices
Parse.Cloud.define('contracts-wip-find-missing-periods', async ({ params: { contractId, apply } }) => {
  const missingPeriods = []

  const contract = await $getOrFail(Contract, contractId)
  const calculatedInvoices = await Parse.Cloud.run('contracts-wip-calculate-invoices', { contractId }, { useMasterKey: true })
  const earlyCancellations = contract.get('earlyCancellations') || {}
  // compare calculated to generated invoices to find date gaps
  const generatedInvoices = await $query('Invoice')
    .equalTo('contract', contract)
    .containedIn('status', [1, 2])
    .notEqualTo('media', null) // generated
    .find({ useMasterKey: true })

  for (const calculated of calculatedInvoices) {
    const generated = generatedInvoices.find((issued) => issued.get('periodStart') === calculated.periodStart)
    if (generated && generated.get('periodEnd') !== calculated.periodEnd) {
      const periodStart = moment(generated.get('periodEnd')).add(1, 'days')
      const periodEnd = moment(calculated.periodEnd)

      // check if period is satisfied by other invoices (ONLY CHECKS SINGLE MATCHING INVOICE, NOT MULTIPLE)
      const startsSame = generatedInvoices.find((issued) => issued.get('periodStart') === periodStart.format('YYYY-MM-DD'))
      if (startsSame && startsSame.get('periodEnd') === periodEnd.format('YYYY-MM-DD')) {
        continue
      }

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
        ...calculated,
        date: invoiceDate,
        periodStart: periodStart.format('YYYY-MM-DD'),
        periodEnd: periodEnd.format('YYYY-MM-DD')
      }

      const mediaItems = []
      let monthlyTotal = 0
      let mediaTotal = 0

      for (const cubeId of contract.get('cubeIds')) {
        // if cube completely canceled skip
        if (earlyCancellations[cubeId] === true) { continue }

        // if cube is canceledEarly, and the early cancelation is before periodStart, skip
        const cubeCanceledAt = earlyCancellations[cubeId] ? moment(earlyCancellations[cubeId]) : null
        if (cubeCanceledAt && cubeCanceledAt.isBefore(periodStart)) {
          continue
        }

        const monthly = invoice.gradualPrice || contract.get('monthlyMedia')?.[cubeId]
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

      invoice.media = {
        items: mediaItems,
        monthlyTotal: round2(monthlyTotal),
        total: round2(mediaTotal)
      }

      invoice.lineItems = getInvoiceLineItems({ media: invoice.media })
      const { netTotal, taxTotal, total } = getDocumentTotals(invoice.address.get('lex').allowTaxFreeInvoices, invoice.lineItems, invoice.date)
      invoice.netTotal = netTotal
      invoice.taxTotal = taxTotal
      invoice.total = total
      // commissions
      if (invoice.media?.total && invoice.agency) {
        invoice.commissionRate = getCommissionForYear(contract, moment(invoice.date).year())
        if (!invoice.commissionRate) {
          delete invoice.agency
          return invoice
        }
        const net = round2((invoice.commissionRate || 0) * invoice.media.total / 100)
        invoice.commission = { net }
      }

      missingPeriods.push(invoice)
    }
  }
  if (!apply) {
    return missingPeriods
  }
  const generated = []
  const Invoice = Parse.Object.extend('Invoice')
  for (const item of missingPeriods) {
    const invoice = new Invoice(item)
    await invoice.save(null, { useMasterKey: true })
    generated.push(invoice.id)
  }
  return generated
}, { requireMaster: true })

function validateProduction (production, cubeIds) {
  const printPackages = production.get('printPackages') || {}
  for (const cubeId of cubeIds) {
    if (!(cubeId in printPackages) || !printPackages[cubeId]) {
      throw new Error('Sie müssen für alle CityCubes ein Belegungspaket auswählen.')
    }
  }
  return true
}

Parse.Cloud.define('contract-invoices-preview', async ({ params: { id: contractId } }) => {
  const contract = await $getOrFail(Contract, contractId)
  if (!(contract.get('status') >= 0 && contract.get('status') < 3)) {
    throw new Error('Can only preview unfinalized contract invoices.')
  }
  if (!contract.get('startsAt') || !contract.get('endsAt')) {
    return []
  }
  return getInvoicesPreview(contract)
}, $internOrAdmin)

Parse.Cloud.define('contract-create', async ({ params, user, master }) => {
  const {
    offerId,
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
    autoExtendsBy,
    pricingModel,
    disassemblyFromRMV
  } = normalizeFields(params)

  const company = await $getOrFail('Company', companyId)
  const offer = offerId ? await $getOrFail('Offer', offerId, 'production') : null
  const contract = new Contract({
    no: master ? params.no : undefined,
    status: 2,
    offer,
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
    autoExtendsBy,
    agency: agencyId ? await $getOrFail('Company', agencyId) : undefined,
    agencyPerson: agencyPersonId ? await $getOrFail('Person', agencyPersonId) : undefined,
    commission,
    commissions,
    responsibles: user ? [$pointer(Parse.User, user.id)] : undefined,
    tags: company.get('tags'),
    disassembly: disassemblyFromRMV
      ? { fromRMV: true }
      : null
  })

  offer && contract.set({
    cubeIds: offer.get('cubeIds'),
    monthlyMedia: offer.get('monthlyMedia'),
    tags: offer.get('tags'),
    responsibles: [...new Set([...(offer.get('responsibles') || []), ...(contract.get('responsibles') || [])].map(user => user.id))]
      .filter(Boolean)
      .map(id => $pointer(Parse.User, id))
  })

  const audit = { user, fn: 'contract-create' }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  if (offer) {
    await offer.set({ contract, status: 3 }).save(null, { useMasterKey: true, context: { audit } })
    if (offer.get('production')) {
      const production = offer.get('production')
      production.save({ contract }, { useMasterKey: true })
    }
  }
  return contract
}, $internOrAdmin)

Parse.Cloud.define('contract-update-cubes', async ({ params: { id: contractId, ...params }, user }) => {
  const contract = await $getOrFail(Contract, contractId, 'company')
  if (contract.get('status') >= 3) {
    throw new Error('CityCubes von finalisierte Verträge können nicht mehr geändert werden.')
  }

  const { cubeIds } = normalizeFields(params)
  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(contract, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  contract.set({ cubeIds })

  if (contract.get('pricingModel') === 'zero') {
    // if zero or fixed pricing update monthly media
    const monthlyMedia = {}
    for (const cubeId of cubeIds) {
      monthlyMedia[cubeId] = 0
    }
    contract.set({ monthlyMedia })
  } else if (contract.get('pricingModel') === 'fixed') {
    // if fixed pricing, set monthly media to fixed price
    const { fixedPrice, fixedPriceMap } = contract.get('company')?.get('contractDefaults') || {}
    if (!fixedPriceMap && !fixedPrice) { return }
    const cubes = await $query('Cube')
      .containedIn('objectId', cubeIds)
      .limit(cubeIds.length)
      .find({ useMasterKey: true })
    const monthlyMedia = {}
    for (const cube of cubes) {
      const price = fixedPrice || fixedPriceMap[cube.get('media')]
      if (price) {
        monthlyMedia[cube.id] = price
      }
    }
    contract.set({ monthlyMedia })
  } else if (contract.get('pricingModel') !== 'gradual') {
    // if not gradual pricing, make sure at least all cubes have monthly media at 0
    const monthlyMedia = contract.get('monthlyMedia') || {}
    for (const cubeId of cubeIds) {
      monthlyMedia[cubeId] = monthlyMedia[cubeId] || 0
    }
    contract.set({ monthlyMedia })
  }

  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  production && production.save(null, { useMasterKey: true })

  const audit = { user, fn: 'contract-update', data: { cubeChanges } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('contract-rate-selection', async ({ params: { id: contractId, cubeId, selectionRating }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  if (contract.get('status') >= 3) {
    throw new Error('Selektionen von finalisierte Verträge können nicht mehr geändert werden.')
  }
  const selectionRatings = await contract.get('selectionRatings') || {}
  if (selectionRatings[cubeId] === selectionRating) {
    throw new Error('Selektion bereits gesetzt.')
  }
  if (selectionRating === '⚪') {
    delete selectionRatings[cubeId]
  } else {
    selectionRatings[cubeId] = selectionRating
  }
  contract.set({ selectionRatings })
  return contract.save(null, { useMasterKey: true })
}, $internOrAdmin)

Parse.Cloud.define('contract-update', async ({ params: { id: contractId, monthlyMedia, production, printNotes, ...params }, user }) => {
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
    autoExtendsBy,
    pricingModel,
    billingCycle,
    invoiceDescription,
    disassemblyFromRMV
  } = normalizeFields(params)

  const contract = await $getOrFail(Contract, contractId, ['all'])
  if (contract.get('status') >= 3) {
    throw new Error('Finalisierte Verträge können nicht mehr geändert werden.')
  }

  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(contract, cubeIds)
  cubeChanges && contract.set({ cubeIds })

  // if zero pricing make sure all cubes are 0€
  if (pricingModel === 'zero') {
    for (const cubeId of cubeIds) {
      monthlyMedia[cubeId] = 0
    }
  }
  // clean monthly prices for missing cubes in form
  if (pricingModel === 'gradual') {
    monthlyMedia = null
  }
  monthlyMedia = $cleanDict(monthlyMedia, cubeIds)

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
    monthlyMedia
  })

  const disassembly = contract.get('disassembly') || {}
  // add disassemblyFromRMV
  if (disassemblyFromRMV !== Boolean(disassembly.fromRMV)) {
    changes.disassemblyFromRMV = [Boolean(disassembly.fromRMV), disassemblyFromRMV]
    disassembly.fromRMV = disassemblyFromRMV
    contract.set({ disassembly })
  }

  if (companyId !== contract.get('company')?.id) {
    changes.companyId = [contract.get('company')?.id, companyId]
    const company = await $getOrFail('Company', companyId, ['tags'])
    contract.set({ company })
    // override company tags
    company.get('tags') ? contract.set('tags', company.get('tags')) : contract.unset('tags')
  }
  if (addressId !== contract.get('address')?.id) {
    const address = addressId ? await $getOrFail('Address', addressId) : null
    changes.address = [contract.get('address'), address].map(addressAudit)
    contract.set({ address })
  }
  if (companyPersonId !== contract.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [contract.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    contract.set({ companyPerson })
  }

  if (invoiceAddressId !== contract.get('invoiceAddress')?.id) {
    const invoiceAddress = invoiceAddressId ? await $getOrFail('Address', invoiceAddressId) : null
    changes.invoiceAddress = [contract.get('invoiceAddress'), invoiceAddress].map(addressAudit)
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
    // clean print packages and printNotes for missing cubes in contract
    for (const cubeId of Object.keys(printPackages || {})) {
      if (!cubeIds.includes(cubeId)) {
        delete printPackages[cubeId]
      }
    }
    for (const cubeId of Object.keys(printNotes || {})) {
      if (!cubeIds.includes(cubeId)) {
        delete printNotes[cubeId]
      }
    }
    productionChanges = existingProduction
      ? $changes(existingProduction, {
        billing,
        printPackages,
        printNotes,
        prices: billing ? prices : null,
        extras: billing ? extras : null
      })
      : { added: true }
    production = existingProduction || new (Parse.Object.extend('Production'))()
    production.set({ contract, billing, printPackages, printNotes, interestRate: null, prices: null, extras: null, totals: null })
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

  const audit = { user, fn: 'contract-update', data: { changes, cubeChanges, productionChanges } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('contract-finalize', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  await validateOrderFinalize(contract)

  // validate production
  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  production && validateProduction(production, contract.get('cubeIds'))

  // check if all cubes have been assigned a monthly price, if the pricing model is not gradual
  if (contract.get('pricingModel') !== 'gradual') {
    const monthlyMedia = contract.get('monthlyMedia') || {}
    for (const cubeId of contract.get('cubeIds')) {
      if (!(cubeId in monthlyMedia)) {
        throw new Error('Sie müssen für alle Werbemedien einen monatlichen Preis eingeben.')
      }
    }
    // Make sure the pricingModel is zero if total media sum is 0€
    if (contract.get('pricingModel') !== 'zero' && !sum(Object.values(contract.get('monthlyMedia') || {}))) {
      throw new Error('Bitte wählen Sie das Preismodell "0€", wenn alle Medienpreise 0€ betragen.')
    }
  }

  const Invoice = Parse.Object.extend('Invoice')
  for (const item of await getInvoicesPreview(contract)) {
    const invoice = new Invoice(item)
    await invoice.save(null, { useMasterKey: true, context: { audit: { fn: 'invoice-generate' } } })
  }

  // cleanup selectionRatings
  contract.set('selectionRatings', $cleanDict(contract.get('selectionRatings'), contract.get('cubeIds')))

  // check if any special formats need to be canceled early
  await earlyCancelSpecialFormats(contract)

  // save cube data in time of finalization
  const cubeData = await $query('Cube')
    .containedIn('objectId', contract.get('cubeIds'))
    .select(['hsnr', 'str', 'plz', 'ort', 'state', 'media', 'ht'])
    .limit(contract.get('cubeIds').length)
    .find({ useMasterKey: true })
    .then(cubes => cubes.reduce((acc, cube) => {
      acc[cube.id] = {
        hsnr: cube.get('hsnr'),
        str: cube.get('str'),
        plz: cube.get('plz'),
        ort: cube.get('ort'),
        stateId: cube.get('state').id,
        media: cube.get('media'),
        htId: cube.get('ht')?.id
      }
      return acc
    }, {}))

  // set contract status to active
  contract.set({ status: 3, cubeData })
  const audit = { user, fn: 'contract-finalize' }
  return contract.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
}, $internOrAdmin)

async function checkIfContractRevertible (contract) {
  if (contract.get('status') !== 3) {
    throw new Error('Vertrag ist nicht finalisiert.')
  }
  const issuedInvoices = await $query('Invoice')
    .equalTo('contract', contract)
    .notEqualTo('media', null)
    .equalTo('status', 2)
    .distinct('lexNo', { useMasterKey: true })
  if (issuedInvoices.length) {
    let message = issuedInvoices.length === 1
      ? 'Sie haben bereits eine Rechnung zu diesem Vertrag ausgestellt. Bitte stornieren Sie diese zuerst. Rechnung: ' + issuedInvoices.join(', ')
      : 'Sie haben bereits Rechnungen zu diesem Vertrag ausgestellt. Bitte stornieren Sie diese zuerst. Rechnungen: ' + issuedInvoices.join(', ')
    message += '\n\n'
    message += 'Mediendienstleistungsverträge sollten nicht gelöscht oder zurückgezogen werden, da sich Veränderungen auf die Pachtkalkulation auswirken können.'
    message += '\n\n'
    message += 'Bitte halten Sie hierzu Rücksprache, um eine andere Lösung zu finden.'
    throw new Error(message)
  }
  if (contract.get('extendedDuration')) {
    let message = 'Sobald sich ein Vertag verlängert hat, kann der Vertrag nicht gelöscht oder zurückgezogen werden.'
    message += '\n\n'
    message += 'Bitte halten Sie hierzu Rücksprache, um eine andere Lösung zu finden.'
    throw new Error(message)
  }
  return true
}

// check if a finalized contract can be re-opened for editing
Parse.Cloud.define('contract-check-revertable', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId, 'company')
  return checkIfContractRevertible(contract)
    .catch((error) => ({ error: error.message }))
}, $internOrAdmin)

// TODO: Make sure to give option to update cube data
Parse.Cloud.define('contract-undo-finalize', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId, 'company')
  await checkIfContractRevertible(contract)
  contract.set({ status: 2.1 })
  const audit = { user, fn: 'contract-undo-finalize' }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  await $query('Invoice')
    .equalTo('contract', contract)
    .containedIn('status', [1, 4])
    .each((invoice) => {
      return invoice.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
  return 'Finalisierung zurückgezogen.'
}, $internOrAdmin)

// Updates all planned and discarded invoices of contract
// Updates gradual prices, periodEnd and early canceled cubes
Parse.Cloud.define('contract-update-planned-invoices', async ({ params: { id: contractId }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  // discard all planned invoices if contract is voided
  if (contract.get('status') === -1) {
    let u = 0
    await $query('Invoice')
      .equalTo('contract', contract)
      .equalTo('status', 1)
      .each(async (invoice) => {
        const invoiceAudit = { user, fn: 'invoice-discard', data: { reason: 'Vertrag storniert.' } }
        await Parse.Cloud.run(
          'invoice-discard',
          { id: invoice.id },
          { useMasterKey: true, context: { audit: invoiceAudit } }
        )
        u++
      }, { useMasterKey: true })
    return u
  }
  const invoices = await $query('Invoice')
    .equalTo('contract', contract)
    .containedIn('status', [1, 4])
    .ascending('periodStart')
    .find({ useMasterKey: true })
  const earlyCancellations = contract.get('earlyCancellations') || {}
  let i = 0
  let u = 0
  const contractStart = contract.get('startsAt')
  const contractEnd = contract.get('endsAt')
  const billingCycle = contract.get('billingCycle')
  const paymentType = contract.get('paymentType')

  const priceChangeAudits = []
  let monthlyMedia = contract.get('monthlyMedia')
  if (contract.get('pricingModel') === 'fixed') {
    await $query('Audit')
      .equalTo('itemClass', 'Contract')
      .equalTo('itemId', contract.id)
      .equalTo('fn', 'contract-extend')
      .eachBatch((audits) => {
        for (const audit of audits) {
          const { endsAt, changes } = audit.get('data')
          changes?.monthlyMedia && priceChangeAudits.push({
            start: endsAt[0],
            end: endsAt[1],
            beforeMonthlyMedia: changes.monthlyMedia[0],
            monthlyMedia: changes.monthlyMedia[1]
          })
        }
      }, { useMasterKey: true })
      // apply the oldest beforeMonthlyMedia as monthlyMedia
    if (priceChangeAudits.length) {
      priceChangeAudits.sort((a, b) => moment(a.start).diff(b.start))
      monthlyMedia = priceChangeAudits[0].beforeMonthlyMedia
    }
  }
  function getMonthlyMedia (date) {
    const changed = priceChangeAudits.find(({ start, end }) => {
      return moment(date).isBetween(start, end, 'day', '[)')
    })
    return changed?.monthlyMedia || monthlyMedia
  }

  for (const invoice of invoices) {
    let updated = false
    const periodStart = invoice.get('periodStart')
    const periodEnd = getPeriodEnd({ periodStart, billingCycle, contractStart, contractEnd, nextInvoice: invoices[i + 1] }).format('YYYY-MM-DD')
    if (contract.get('pricingModel') === 'gradual') {
      const { gradualCount, gradualPrice } = await getPredictedCubeGradualPrice(contract, periodStart)
      invoice.set('gradualCount', gradualCount)
      invoice.set('gradualPrice', gradualPrice)
    }

    const monthlyMedia = getMonthlyMedia(periodStart)
    const mediaItems = []
    let monthlyTotal = 0
    let mediaTotal = 0

    for (const cubeId of contract.get('cubeIds')) {
      const monthly = invoice.get('gradualPrice') || monthlyMedia[cubeId]
      // if cube completely canceled skip
      if (earlyCancellations[cubeId] === true) { continue }
      const cubeCanceledAt = earlyCancellations[cubeId] ? moment(earlyCancellations[cubeId]) : null
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

    let replanned = false
    if (periodStart <= contractEnd && invoice.get('status') === 4) {
      invoice.set('status', 1)
      replanned = true
    }

    if (paymentType !== invoice.get('paymentType')) {
      invoice.set('paymentType', paymentType)
      replanned = true
    }

    const media = {
      items: mediaItems,
      monthlyTotal: round2(monthlyTotal),
      total: round2(mediaTotal)
    }

    if (media.total === 0) {
      await invoice.destroy({ useMasterKey: true })
      consola.info('Possible duplicate invoice with 0 Total removed from contract', contract.id, 'invoice', invoice.id)
      i++
      u++
      continue
    }

    // production never changes!
    const lineItems = getInvoiceLineItems({ production: invoice.get('production'), media })
    const changes = $changes(invoice, { periodEnd, lineItems })
    if (replanned || Object.keys(changes).length) {
      invoice.set({
        periodEnd,
        media,
        lineItems
      })
      const audit = { user, fn: 'invoice-regenerate', data: { changes, replanned } }
      await invoice.save(null, { useMasterKey: true, context: { rewriteIntroduction: true, audit } })
      updated = true
    } else if (!isEqual(mediaItems, invoice.get('media').items)) {
      // sometimes mediaItems change when cubes are switched, in which case we want to only update media items
      invoice.set({ media })
      await invoice.save(null, { useMasterKey: true })
      updated = true
    }

    // discard if starts after contract ends
    if (periodStart > contractEnd) {
      // discard if period is after contract end
      if (invoice.get('status') === 1) {
        const invoiceAudit = { user, fn: 'invoice-discard', data: { reason: 'Vertrag enddatum geändert.' } }
        await Parse.Cloud.run(
          'invoice-discard',
          { id: invoice.id },
          { useMasterKey: true, context: { audit: invoiceAudit } }
        )
        updated = true
      }
    }
    i++
    updated && (u++)
  }

  return u
}, $internOrAdmin)

// recreates canceled invoice
Parse.Cloud.define('contract-regenerate-canceled-invoice', async ({ params: { id: invoiceId }, user }) => {
  const canceledInvoice = await $getOrFail('Invoice', invoiceId, ['contract'])
  const contract = canceledInvoice.get('contract')
  if (await $query('Invoice').equalTo('duplicateOf', canceledInvoice).first({ useMasterKey: true })) {
    throw new Error('Sie haben diese Rechnung bereits einmal dupliziert.')
  }
  const Invoice = Parse.Object.extend('Invoice')
  const invoice = new Invoice({
    status: 1,
    date: canceledInvoice.get('date'),
    company: contract.get('company'),
    address: contract.get('invoiceAddress') || contract.get('address'),
    paymentType: contract.get('paymentType'),
    dueDays: contract.get('dueDays'),
    companyPerson: contract.get('companyPerson'),
    contract,
    tags: contract.get('tags'),
    periodStart: canceledInvoice.get('periodStart'),
    periodEnd: canceledInvoice.get('periodEnd'),
    cubeCount: canceledInvoice.get('cubeCount'),
    agency: canceledInvoice.get('agency'),
    media: canceledInvoice.get('media'),
    producion: canceledInvoice.get('production'),
    lineItems: canceledInvoice.get('lineItems'),
    duplicateOf: canceledInvoice.toPointer()
  })
  // recalculate commission rate at date
  invoice.get('agency')
    ? invoice.set('commissionRate', getCommissionForYear(contract, moment(invoice.get('date')).year()))
    : invoice.unset('commissionRate')
  const audit = { user, fn: 'invoice-regenerate-from-canceled', data: { invoiceNo: canceledInvoice.get('lexNo') } }
  return invoice.save(null, { useMasterKey: true, context: { audit, rewriteIntroduction: true } })
}, $internOrAdmin)

Parse.Cloud.define('contract-generate-cancellation-credit-note', async ({ params: { id: contractId, cancellations }, user }) => {
  const contract = await $getOrFail(Contract, contractId)
  // check if there are issued invoices that fall under the cancellation dates
  const issuedInvoices = await $query('Invoice')
    .equalTo('contract', contract)
    .notEqualTo('media', null)
    .equalTo('status', 2)
    .find({ useMasterKey: true })
  if (!issuedInvoices.length) { return }
  const invoiceAddress = issuedInvoices[0].get('address')
  if (issuedInvoices.find(invoice => invoice.get('address')?.id !== invoiceAddress.id)) {
    throw new Error('Es wurden verschiedene Rechnungsadressen verwendet. Schreiben Sie die Gutschrift manuell.')
  }

  // create a credit note
  const invoiceTotals = {}
  const creditNoteMediaItems = {}
  for (const cubeId of Object.keys(cancellations)) {
    const cubeEnd = cancellations[cubeId]
    for (const invoice of issuedInvoices) {
      const invoiceNo = invoice.get('lexNo')
      const invoiceMediaItems = invoice.get('media').items
      const mediaItem = invoiceMediaItems.find(item => item.cubeId === cubeId)
      if (!mediaItem) {
        continue
      }
      const periodStart = invoice.get('periodStart')
      const periodEnd = mediaItem.periodEnd || invoice.get('periodEnd')
      // cube canceled already before the invoice
      if (cubeEnd === true || moment(cubeEnd).isBefore(periodStart)) {
        const diff = mediaItem.total
        if (!diff) { continue }
        if (invoiceTotals[invoiceNo] === undefined) {
          invoiceTotals[invoiceNo] = 0
        }
        invoiceTotals[invoiceNo] += diff
        const key = [invoice.id, cubeId].join(':')
        creditNoteMediaItems[key] = {
          start: invoice.get('periodStart'),
          end: periodEnd,
          total: diff
        }
        continue
      }
      // cube canceled within the invoice period
      if (moment(cubeEnd).isBefore(periodEnd)) {
        const { monthly, total } = mediaItem
        const { total: newTotal } = getPeriodTotal(periodStart, cubeEnd, monthly)
        const diff = round2(total - newTotal)
        if (!diff) { continue }
        if (invoiceTotals[invoiceNo] === undefined) {
          invoiceTotals[invoiceNo] = 0
        }
        invoiceTotals[invoiceNo] += diff
        const key = [invoice.id, cubeId].join(':')
        creditNoteMediaItems[key] = {
          start: cubeEnd,
          end: periodEnd,
          total: diff
        }
      }
    }
  }

  const total = round2(sum(Object.values(creditNoteMediaItems).map(item => item.total)))
  const invoiceNos = Object.keys(invoiceTotals)
  if (!total || !invoiceNos.length) { return }
  const invoices = await $query('Invoice')
    .containedIn('lexNo', invoiceNos)
    .limit(invoiceNos.length)
    .find({ useMasterKey: true })
    .then(invs => invs.map(inv => inv.toPointer()))

  const creditNotePeriodStart = Object.values(creditNoteMediaItems).reduce((min, item) => {
    if (!min) { return item.start }
    return moment(item.start).isBefore(min) ? item.start : min
  }, null)
  const creditNotePeriodEnd = Object.values(creditNoteMediaItems).reduce((max, item) => {
    if (!max) { return item.end }
    return moment(item.end).isAfter(max) ? item.end : max
  }, null)

  const creditNote = $parsify('CreditNote')
  creditNote.set({
    company: contract.get('company'),
    address: invoiceAddress,
    companyPerson: contract.get('companyPerson'),
    contract,
    invoices,
    mediaItems: creditNoteMediaItems,
    periodStart: creditNotePeriodStart,
    periodEnd: creditNotePeriodEnd,
    status: 0,
    date: await $today(),
    lineItems: [{ name: 'Dauerwerbung Media', price: total }],
    reason: [
      'Folgende CityCubes entfallen von Vertrag:',
      Object.keys(cancellations).map(cubeId => `${cubeId}: ${cancellations[cubeId] === true ? 'Herausgenommen' : moment(cancellations[cubeId]).format('DD.MM.YYYY')}`).join(', '),
      `Folgende ${invoiceNos.length > 1 ? 'Rechnungen wurden' : 'Rechnung wurde'} gutgeschrieben:`,
      invoiceNos.map((invoiceNo) => `${invoiceNo}: ${priceString(invoiceTotals[invoiceNo])}€`).join(', ')
    ].join('\n')
  })
  const audit = { user, fn: 'credit-note-generate' }
  return creditNote.save(null, { useMasterKey: true, context: { audit } })
}, { requireMaster: true })

Parse.Cloud.define('contract-extend-send-mail', async ({ params: { id: contractId, email, fixedPricesUpdated }, user }) => {
  if (!email) {
    throw new Error(`Bad email ${email}`)
  }
  const contract = await $getOrFail(Contract, contractId)
  if (contract.get('status') !== 3) {
    throw new Error('Can\'t send inactive contract extend mails')
  }
  const attachments = [{
    filename: `${contract.get('no')} Verlängerung.pdf`,
    contentType: 'application/pdf',
    href: process.env.EXPORTS_SERVER_URL + '/contract-extend-pdf?id=' + contract.id + '&fixedPricesUpdated=' + (fixedPricesUpdated || ''),
    httpHeaders: {
      'x-exports-master-key': process.env.EXPORTS_MASTER_KEY
    }
  }]
  const template = 'contract-extend'
  const mailStatus = await sendInfoMail({
    to: email,
    subject: `CityCube Vertragsverlängerung ${contract.get('no')}`,
    template,
    variables: {
      contract: contract.toJSON()
    },
    attachments
  })
  const audit = { fn: 'send-email', user, data: { template, mailStatus } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

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

  const invoiceAddressId = normalizeFields(params).invoiceAddressId

  const changes = {}
  const currentInvoiceAddress = contract.get('invoiceAddress') || contract.get('address')
  if (invoiceAddressId === currentInvoiceAddress.id) {
    throw new Error('Keine Änderungen')
  }
  const invoiceAddress = invoiceAddressId ? await $getOrFail('Address', invoiceAddressId) : null
  changes.invoiceAddress = [currentInvoiceAddress, invoiceAddress].map(addressAudit)
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
    if (!$cleanDict(invoiceChanges)) {
      continue
    }
    const invoiceAudit = { user, fn: 'invoice-update', data: { changes: invoiceChanges } }
    await invoice.save(null, { useMasterKey: true, context: { audit: invoiceAudit } })
  }
  const audit = { user, fn: 'contract-update', data: { changes } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

/**
 * Change contract infos and update all planned invoices
 */
Parse.Cloud.define('contract-change-infos', async ({
  params: {
    id: contractId,
    ...params
  }, user
}) => {
  const contract = await $getOrFail(Contract, contractId, ['address', 'invoiceAddress'])
  if (contract.get('status') < 3) {
    throw new Error('Only active contracts can be changed')
  }

  const {
    motive,
    externalOrderNo,
    campaignNo,
    invoiceDescription
  } = normalizeFields(params)

  const changes = $changes(contract, { motive, externalOrderNo, campaignNo, invoiceDescription })
  contract.set({ motive, externalOrderNo, campaignNo, invoiceDescription })
  const audit = { user, fn: 'contract-update', data: { changes } }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  await $query('Invoice')
    .equalTo('contract', contract)
    .containedIn('status', [1, 4])
    .each(async invoice => invoice.save(null, { useMasterKey: true, context: { rewriteIntroduction: true } }), { useMasterKey: true })
  return contract
}, $internOrAdmin)

/**
 * When a contract commission is changed, the specified planned invoices are updated
 */
Parse.Cloud.define('contract-change-commission', async ({
  params: {
    id: contractId,
    hasCommission,
    commissionType,
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
  if (commissionType !== 'yearly') {
    params.commissions = null
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
    .containedIn('status', [1, 4])
    .find({ useMasterKey: true })

  for (const invoice of invoices) {
    const commissionRate = getCommissionForYear(contract, moment(invoice.get('date')).year())
    const invoiceChanges = $changes(invoice, { commissionRate })
    const invoiceAgencyId = commissionRate ? agencyId : null
    if (invoiceAgencyId !== invoice.get('agency')?.id) {
      invoiceChanges.agencyId = [invoice.get('agency')?.id, invoiceAgencyId]
    }
    if (!$cleanDict(invoiceChanges)) {
      continue
    }
    const invoiceAudit = { user, fn: 'invoice-update', data: { changes: invoiceChanges } }
    invoice.set({
      agency: invoiceAgencyId ? await $getOrFail('Company', invoiceAgencyId) : null,
      commissionRate
    })
    await invoice.save(null, { useMasterKey: true, context: { audit: invoiceAudit } })
  }
  const audit = { user, fn: 'contract-update', data: { changes } }
  return contract.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('contract-toggle-auto-invoice-emails', async ({ params: { id: contractId }, user }) => {
  const contract = await $query(Contract).get(contractId, { useMasterKey: true })
  const toggle = !contract.get('skipInvoiceEmails')
  contract.set('skipInvoiceEmails', toggle)
  const audit = { user, fn: 'contract-toggle-auto-invoice-emails', data: { send: !contract.get('skipInvoiceEmails') } }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  return contract.get('skipInvoiceEmails')
    ? 'Belege werden nicht automatisch per E-Mail verschickt.'
    : 'Belege werden automatisch per E-Mail verschickt.'
}, $internOrAdmin)

Parse.Cloud.define('contract-generate-doc', async ({ params: { id: contractId }, user }) => {
  const contract = await $query(Contract).get(contractId, { useMasterKey: true })
  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  production && validateProduction(production, contract.get('cubeIds'))
  const wasGenerated = Boolean(contract.get('driveFileId'))
  contract.set({ driveFileId: await generateContract(contract) })
  const audit = { user, fn: 'contract-generate-doc', data: { wasGenerated } }
  await contract.save(null, { useMasterKey: true, context: { audit } })
  return contract.get('driveFileId')
}, $internOrAdmin)

Parse.Cloud.define('contract-remove', async ({ params: { id: contractId } }) => {
  const contract = await $getOrFail(Contract, contractId)
  if (contract.get('status') !== 0 && contract.get('status') !== 2) {
    throw new Error('Nur Entwürfe können gelöscht werden.')
  }
  return contract.destroy({ useMasterKey: true })
}, $internOrAdmin)

async function generateExtensionInvoices (contractId, newEndsAt, previousEndsAt) {
  let message = ''
  const contract = await $getOrFail(Contract, contractId, ['company', 'address', 'invoiceAddress'])
  if (contract.get('pricingModel') !== 'zero') {
    const billingCycle = contract.get('billingCycle') || 12
    const newInvoices = []
    // Generate new periodic invoices for one year
    let periodStart = moment(previousEndsAt).add(1, 'day')
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
        // if cube completely canceled skip
        if (earlyCancellations[cubeId] === true) { continue }
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
        const commissionRate = getCommissionForYear(contract, periodStart.year())
        if (commissionRate) {
          invoice.commissionRate = commissionRate
        } else {
          delete invoice.agency
        }
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
}

module.exports = {
  generateExtensionInvoices
}
