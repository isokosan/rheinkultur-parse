const { getDocumentTotals, getPeriodTotal } = require('./../src/shared')
const { round2, round5 } = require('./../src/utils')
const BILLING_CYCLE = 3

function getContractCommissionForYear (contract, year) {
  if (contract.get('commissions')) {
    return contract.get('commissions')[year] !== undefined
      ? contract.get('commissions')[year]
      : contract.get('commission')
  }
  return contract.get('commission')
}

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
async function getInvoicesPreview (contract, from, to) {
  const invoicesPreview = []
  const contractStart = moment(from || contract.get('startsAt'))
  const contractEnd = moment(to || contract.get('endsAt'))
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
        invoice.commissionRate = getContractCommissionForYear(contract, moment(invoice.date).year())
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

async function updateContractBillingCycle (contract) {
  const billingCycle = BILLING_CYCLE
  const changes = $changes(contract, { billingCycle })
  if (Object.keys(changes).length) {
    contract.set({ billingCycle })
    const audit = { fn: 'contract-update', data: { changes } }
    await contract.save(null, { useMasterKey: true, context: { audit } })
  }
  // delete all future planned invoices
  await $query('Invoice')
    .equalTo('contract', contract)
    .equalTo('status', 1)
    .notEqualTo('media', null)
    .equalTo('production', null)
    .each(invoice => invoice.destroy({ useMasterKey: true }), { useMasterKey: true })
  const from = await $query('Invoice')
    .equalTo('contract', contract)
    .equalTo('status', 2)
    .notEqualTo('media', null)
    .descending('periodEnd')
    .first({ useMasterKey: true })
    .then((invoice) => {
      const periodEnd = invoice.get('periodEnd')
      return moment(periodEnd).add(1, 'day').format('YYYY-MM-DD')
    })
  const Invoice = Parse.Object.extend('Invoice')
  for (const item of await getInvoicesPreview(contract, from)) {
    const invoice = new Invoice(item)
    await invoice.save(null, { useMasterKey: true, context: { audit: { fn: 'invoice-generate' } } })
  }
  console.log('contract done', contract.get('no'))
}

async function run () {
  // const company = await $getOrFail('Company', 'rBRozYiVzN')
  // await $query('Contract')
  //   .equalTo('status', 3)
  //   .equalTo('company', company)
  //   .notEqualTo('billingCycle', BILLING_CYCLE)
  //   .include(['address', 'invoiceAddress', 'production', 'company'])
  //   .each(async (contract) => {
  //     if (contract.get('production')) {
  //       throw new Error('Custom period invoice generation on contracts with production is not yet supported.')
  //     }
  //     if (contract.get('earlyCancellations')) {
  //       throw new Error('Custom period invoice generation on contracts with early canceled cubes is not yet supported.')
  //     }
  //     return updateContractBillingCycle(contract)
  //   }, { useMasterKey: true })

  const contract = await $getOrFail('Contract', '15Tv0LRAZJ', ['address', 'invoiceAddress', 'production', 'company'])
  await updateContractBillingCycle(contract)
  console.log('OK')
}

require('./run')(run)
