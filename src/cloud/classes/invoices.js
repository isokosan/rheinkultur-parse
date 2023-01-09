const { normalizeString, invoices: { normalizeFields } } = require('@/schema/normalizers')
const { getTaxRateOnDate, getPeriodTotal } = require('@/shared')
const { round2, priceString, durationString } = require('@/utils')
const { lexApi, getLexDocumentAttachment } = require('@/services/lex')
const { getPredictedCubeGradualPrice, getGradualPrice, getGradualCubeCount } = require('./gradual-price-maps')
const sendMail = require('@/services/email')

const Invoice = Parse.Object.extend('Invoice', {
  getTotalText () {
    return priceString(this.get('total')) + '€'
  },
  getPaymentDate () {
    return moment(this.get('date')).add(this.get('dueDays'), 'days').format('DD.MM.YYYY')
  },
  async getCompanyPersonSupplement () {
    const companyPerson = this.get('companyPerson')
    if (!companyPerson) {
      return
    }
    if (companyPerson.get('lastName')) {
      await companyPerson.fetch({ useMasterKey: true })
    }
    const { prefix, firstName, lastName } = companyPerson.attributes
    return [prefix, firstName, lastName].filter(x => x).join(' ')
  },
  async getIntroduction () {
    const lines = []
    if (this.get('media')) {
      lines.push('Leistung: Dauerhinweiswerbung auf Schaltkasten (CityCube)')
    }
    const contract = this.get('contract')
    if (contract) {
      if (!contract.get('no')) {
        await contract.fetch({ useMasterKey: true })
      }
      lines.push(`Vertragsnummer: ${contract.get('no')}`)
      const [start, end] = [contract.get('startsAt'), contract.get('endsAt')]
        .map(dateString => moment(dateString).format('DD.MM.YYYY'))
      let duration = contract.get('initialDuration')
      const extendedDuration = contract.get('extendedDuration')
      if (extendedDuration) {
        duration += ` + ${extendedDuration}`
      }
      lines.push(`Vertragszeitraum: von ${start} bis ${end} (${duration} Monate)`)
    }
    const booking = this.get('booking')
    if (booking) {
      if (!booking.get('no')) {
        await booking.fetch({ useMasterKey: true })
      }
      lines.push(`Buchungsnummer: ${booking.get('no')}`)
      const [start, end] = [booking.get('startsAt'), booking.get('endsAt')]
        .map(dateString => moment(dateString).format('DD.MM.YYYY'))
      let duration = booking.get('initialDuration')
      const extendedDuration = booking.get('extendedDuration')
      if (extendedDuration) {
        duration += ` + ${extendedDuration}`
      }
      lines.push(`Buchungszeitraum: von ${start} bis ${end} (${duration} Monate)`)
    }
    const [periodStart, periodEnd] = [this.get('periodStart'), this.get('periodEnd')]
    if (periodStart && periodEnd) {
      const [start, end] = [periodStart, periodEnd]
        .map(dateString => moment(dateString).format('DD.MM.YYYY'))
      lines.push(`Abrechnungszeitraum: ${start} - ${end} (${durationString(periodEnd, periodStart)})`)
    }
    const motive = booking?.get('motive') || contract?.get('motive')
    if (motive) {
      lines.push(`Motiv: ${motive}`)
    }
    const externalOrderNo = booking?.get('externalOrderNo') || contract?.get('externalOrderNo')
    if (externalOrderNo) {
      const label = (this.get('tags') || []).find(tag => tag.id === 'ALDI') ? 'VST-Nummer' : 'Auftragsnr.'
      lines.push(`${label}: ${externalOrderNo}`)
    }
    const campaignNo = booking?.get('campaignNo') || contract?.get('campaignNo')
    if (campaignNo) {
      const label = (this.get('tags') || []).find(tag => tag.id === 'ALDI') ? 'Regionalgesellschaft' : 'Kampagnensnr.'
      lines.push(`${label}: ${campaignNo}`)
    }
    if (this.get('media')?.items) {
      lines.push(`Anzahl CityCubes: ${this.get('media').items.length}`)
    } else if (this.get('production')?.items) {
      lines.push(`Anzahl CityCubes: ${this.get('production').items.length}`)
    }
    if (contract?.get('invoiceDescription')) {
      lines.push(contract.get('invoiceDescription'))
    }
    return normalizeString(lines.join('\n'))
  }
})

function getInvoiceTotals (lineItems, date) {
  let netTotal = 0
  for (const item of lineItems) {
    netTotal = round2(netTotal + item.price)
  }
  const taxTotal = round2(netTotal * getTaxRateOnDate(date) / 100)
  const total = round2(netTotal + taxTotal)
  return { netTotal, taxTotal, total }
}

async function getLexDocumentId (lexId) {
  return lexApi('/invoices/' + lexId + '/document', 'GET')
    .then(({ documentFileId }) => documentFileId)
}

function updateGradualInvoice (invoice, gradualCount, gradualPrice) {
  invoice.set('gradualCount', gradualCount)
  invoice.set('gradualPrice', gradualPrice)
  const { total: periodGradualTotal } = getPeriodTotal(invoice.get('periodStart'), invoice.get('periodEnd'), gradualPrice)
  const media = invoice.get('media')
  let monthlyTotal = 0
  let total = 0
  for (const index of Object.keys(media.items || [])) {
    const item = media.items[index]
    item.monthly = gradualPrice
    monthlyTotal += gradualPrice
    item.total = periodGradualTotal
    total += periodGradualTotal
    media.items[index] = item
  }
  media.monthlyTotal = round2(monthlyTotal)
  media.total = round2(total)
  invoice.set('media', media)
  const lineItems = invoice.get('lineItems')
  lineItems[0].price = round2(invoice.get('media')?.total || 0 + invoice.get('production')?.total || 0)
  invoice.set('lineItems', lineItems)
  return invoice.save(null, { useMasterKey: true })
}

Parse.Cloud.beforeFind(Invoice, async ({ query }) => {
  query.include('contract')
  if (query._include.includes('all')) {
    query.include([
      'company',
      'address',
      'contract',
      'booking',
      'bookings',
      'docs'
    ])
  }
})

Parse.Cloud.beforeSave(Invoice, async ({ object: invoice, context: { rewriteIntroduction } }) => {
  invoice.get('status') === undefined && invoice.set('status', 0)
  invoice.get('voucherStatus') === 'voided' && invoice.set('status', 3)

  const address = invoice.get('address')
  if (!address.get('lex')) {
    await address.fetch({ useMasterKey: true })
    if (!address.get('lex')) {
      throw new Error('Rechnungsadresse muss auf LexOffice gespeichert sein')
    }
  }

  !invoice.get('extraCols') && invoice.unset('extraCols')
  if (invoice.isNew()) {
    if (invoice.get('dueDays') === undefined) {
      invoice.set('dueDays', 14)
    }
  }
  if (invoice.isNew() || rewriteIntroduction) {
    invoice.set('introduction', await invoice.getIntroduction())
  }

  if (!invoice.get('media')) {
    invoice.unset('agency')
    invoice.unset('commissionRate')
  }

  if (invoice.get('agency')) {
    if (invoice.get('agency').id === invoice.get('company').id) {
      throw new Error('Agentur und Kunde können nicht dasselbe Unternehmen sein.')
    }
    if (!invoice.get('commissionRate')) {
      throw new Error('Provisionssatz ist erforderlich, wenn die Rechnung eine Agentur enthält.')
    }
  }

  // dueDate
  invoice.set('dueDate', moment(invoice.get('date')).add(invoice.get('dueDays'), 'days').toDate())

  // total
  if (invoice.get('status') < 2 && invoice.get('lineItems')) {
    const { netTotal, taxTotal, total } = getInvoiceTotals(invoice.get('lineItems'), invoice.get('date'))
    invoice.set({ netTotal, taxTotal, total })
  }

  if (invoice.get('lexId') && !invoice.get('lexNo')) {
    const { voucherNumber, voucherStatus } = await lexApi('/invoices/' + invoice.get('lexId'), 'GET')
    invoice.set({ lexNo: voucherNumber, voucherStatus })
  }
})

Parse.Cloud.afterSave(Invoice, ({ object: invoice, context: { audit } }) => { $audit(invoice, audit) })

Parse.Cloud.beforeDelete(Invoice, ({ object: invoice }) => {
  if (invoice.get('lexId')) {
    throw new Error('Rechnungen, die mit lexoffice synchronisiert wurden, können nicht gelöscht werden.')
  }
})

Parse.Cloud.afterDelete(Invoice, $deleteAudits)

Parse.Cloud.define('invoice-create', async ({ params, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const {
    companyId,
    addressId,
    companyPersonId,
    contractId,
    bookingId,
    date,
    paymentType,
    dueDays,
    periodStart,
    periodEnd,
    agencyId,
    commissionRate,
    lessorId,
    lessorRate,
    lineItems,
    extraCols
  } = normalizeFields(params)

  const invoice = new Invoice({
    status: 0,
    company: await $getOrFail('Company', companyId),
    address: await $getOrFail('Address', addressId),
    date,
    lessorRate,
    commissionRate,
    lineItems,
    periodStart,
    periodEnd,
    paymentType,
    dueDays,
    extraCols,
    createdBy: user
  })
  companyPersonId && invoice.set('companyPerson', await $getOrFail('Person', companyPersonId))
  contractId && invoice.set('contract', await $getOrFail('Contract', contractId))
  bookingId && invoice.set('booking', await $getOrFail('Booking', bookingId))
  lessorId && invoice.set('lessor', await $getOrFail('Company', lessorId))
  agencyId && invoice.set('agency', await $getOrFail('Company', agencyId))

  invoice.set({ tags: invoice.get('company').get('tags') })

  const audit = { user, fn: 'invoice-create' }
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('invoice-update', async ({ params: { id: invoiceId, ...params }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const {
    companyId,
    addressId,
    companyPersonId,
    date,
    paymentType,
    dueDays,
    periodStart,
    periodEnd,
    lessorId,
    lessorRate,
    agencyId,
    commissionRate,
    introduction,
    lineItems,
    extraCols
  } = normalizeFields(params)

  const invoice = await $getOrFail(Invoice, invoiceId, ['address', 'companyPerson'])
  const changes = $changes(invoice, {
    date,
    paymentType,
    dueDays,
    periodStart,
    periodEnd,
    introduction,
    lineItems,
    extraCols
  })

  invoice.set({
    date,
    paymentType,
    dueDays,
    periodStart,
    periodEnd,
    introduction,
    lineItems,
    extraCols
  })

  if (companyId !== invoice.get('company')?.id) {
    changes.companyId = [invoice.get('company')?.id, companyId]
    invoice.set({ company: await $getOrFail('Company', companyId) })
  }
  if (addressId !== invoice.get('address')?.id) {
    const address = addressId ? await $getOrFail('Address', addressId) : null
    changes.address = [invoice.get('address')?.get('name'), address?.get('name')]
    address ? invoice.set({ address }) : invoice.unset('address')
  }

  if (companyPersonId !== invoice.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [invoice.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    companyPerson ? invoice.set({ companyPerson }) : invoice.unset('companyPerson')
  }

  if (agencyId !== invoice.get('agency')?.id) {
    const agency = agencyId ? await $getOrFail('Company', agencyId) : null
    changes.agencyId = [invoice.get('agency')?.id, agencyId]
    agency ? invoice.set({ agency }) : invoice.unset('agency')
  }
  if (commissionRate !== invoice.get('commissionRate')) {
    changes.commissionRate = [invoice.get('commissionRate'), commissionRate]
    commissionRate ? invoice.set({ commissionRate }) : invoice.unset('commissionRate')
  }

  if (lessorId !== invoice.get('lessor')?.id) {
    const lessor = lessorId ? await $getOrFail('Company', lessorId) : null
    changes.lessorId = [invoice.get('lessor')?.id, lessorId]
    lessor ? invoice.set({ lessor }) : invoice.unset('lessor')
  }
  if (lessorRate !== invoice.get('lessorRate')) {
    changes.lessorRate = [invoice.get('lessorRate'), lessorRate]
    lessorRate ? invoice.set({ lessorRate }) : invoice.unset('lessorRate')
  }
  const audit = { user, fn: 'invoice-update', data: { changes } }
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('invoice-update-extra-cols', async ({ params: { id: invoiceId, ...params }, user }) => {
  const { extraCols } = normalizeFields(params)
  const invoice = await $getOrFail(Invoice, invoiceId)
  const changes = $changes(invoice, { extraCols })
  invoice.set({ extraCols })
  const audit = { user, fn: 'invoice-update', data: { changes } }
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('invoice-remove', async ({ params: { id: invoiceId } }) => {
  const invoice = await $getOrFail(Invoice, invoiceId)
  if (invoice.get('status')) {
    throw new Error('Geplante Rechnungen können nicht gelöscht werden.')
  }
  return invoice.destroy({ useMasterKey: true })
}, { requireUser: true })

// email: true (the email defined in invoice address will be used) | string (the custom email will be used) | false (no email will be send)
Parse.Cloud.define('invoice-issue', async ({ params: { id: invoiceId, email }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  let invoice = await $getOrFail(Invoice, invoiceId, ['company', 'address', 'companyPerson'])
  if (invoice.get('status') > 1) {
    throw new Error('Diese Rechnung wurde bereits ausgestellt.')
  }
  if (moment(await $today()).isBefore(invoice.get('date'), 'day')) {
    throw new Error('Rechnungsdatum ist noch nicht erreicht.')
  }
  if (invoice.get('total') === 0) {
    throw new Error('Rechnungen mit einem Gesamtbetrag von 0€ können nicht ausgestellt werden.')
  }
  const { lex, name, supplement, street, zip, city, countryCode } = invoice.get('address').attributes
  if (!lex?.id) {
    throw new Error(`Die Abrechnungsaddresse ist noch nicht vollständig hinterlegt. Bitte überprüfen Sie die Stammdaten. (${invoice.id})`)
  }
  // recalculate if pricingModel is cubeCount
  if (invoice.get('media') && invoice.get('contract')?.get('pricingModel') === 'gradual') {
    invoice = await Parse.Cloud.run('invoice-recalculate-gradual-prices', { id: invoiceId }, { useMasterKey: true })
  }
  const { id: lexId, resourceUri: lexUri } = await lexApi('/invoices?finalize=true', 'POST', {
    archived: false,
    voucherDate: moment(invoice.get('date'), 'YYYY-MM-DD').toDate(),
    address: {
      contactId: lex.id,
      name,
      supplement,
      street,
      zip,
      city,
      countryCode
    },
    lineItems: invoice.get('lineItems').map((item) => {
      return {
        type: 'custom',
        name: item.name,
        description: item.description,
        quantity: 1,
        unitName: 'Stück',
        unitPrice: {
          currency: 'EUR',
          netAmount: item.price,
          taxRatePercentage: lex.allowTaxFreeInvoices ? 0 : getTaxRateOnDate(invoice.get('date'))
        },
        discountPercentage: 0
      }
    }),
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType: 'net' },
    paymentConditions: {
      paymentTermLabel: invoice.get('paymentType') === 1
        ? `Der Betrag ${invoice.getTotalText()} wird per Lastschrift von Ihrem Konto eingezogen.`
        : `Zahlbar per Überweisung ${invoice.getTotalText()} bis zum ${invoice.getPaymentDate()} ohne Abzug.`,
      paymentTermDuration: invoice.get('dueDays') || 0
    },
    shippingConditions: {
      shippingType: 'none'
    },
    title: 'Rechnung',
    introduction: invoice.get('introduction'),
    remark: invoice.get('paymentType') === 1
      ? ''
      : 'Bitte geben Sie bei der Überweisung die Rechnungsnummer an, nur so können wir ihre Zahlung korrekt zuordnen.'
  })
  invoice.set({ lexId, lexUri })
  invoice.set('status', 2)
  const audit = { user, fn: 'invoice-issue' }
  await invoice.save(null, { useMasterKey: true, context: { audit } })

  let message = 'Rechnung ausgestellt.'
  if (email === true) {
    email = invoice.get('address').email
  }
  email && await Parse.Cloud.run('invoice-send-mail', { id: invoice.id, email }, { useMasterKey: true })
    .then(() => { message += ` Email an ${email} gesendet.` })
    .catch(consola.error)
  return message
}, { requireUser: true })

Parse.Cloud.define('invoice-send-mail', async ({ params: { id: invoiceId, email }, user }) => {
  if (!email) {
    throw new Error(`Bad email ${email}`)
  }
  const invoice = await $query(Invoice)
    .include(['company', 'docs'])
    .get(invoiceId, { useMasterKey: true })
  if (invoice.get('status') < 2) {
    throw new Error('Can\'t mail draft invoice')
  }
  const attachments = []
  const lexDocumentId = await getLexDocumentId(invoice.get('lexId'))
  lexDocumentId && attachments.push({
    filename: invoice.get('lexNo') + '.pdf',
    ...getLexDocumentAttachment(lexDocumentId)
  })
  if (invoice.get('media') || invoice.get('production')) {
    attachments.push({
      filename: invoice.get('lexNo') + ' Rechnungs-Standorte.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      href: process.env.EXPORTS_SERVER_URL + '/invoice-summary?id=' + invoice.id
    })
  }
  for (const doc of invoice.get('docs') || []) {
    attachments.push({
      filename: doc.get('name'),
      contentType: doc.get('contentType'),
      href: doc.get('file')._url
    })
  }
  const mailStatus = await sendMail({
    to: email,
    subject: `Rechnung ${invoice.get('lexNo')}`,
    template: 'invoice',
    variables: {
      invoice: invoice.toJSON(),
      company: invoice.get('company').toJSON()
    },
    attachments
  })
  invoice.set({ mailStatus })
  const audit = { fn: 'send-email', user, data: { mailStatus } }
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('invoice-discard', async ({ params: { id: invoiceId }, user, context: { audit: predefinedAudit } }) => {
  const invoice = await $getOrFail(Invoice, invoiceId)
  if (invoice.get('status') !== 1) {
    throw new Error('Can only discard planned invoice')
  }
  const audit = predefinedAudit || { user, fn: 'invoice-discard' }
  invoice.set({ status: 4 })
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('invoice-reset-introduction', async ({ params: { id: invoiceId }, user }) => {
  const invoice = await $getOrFail(Invoice, invoiceId, ['contract', 'booking'])
  if (invoice.get('status') > 1) {
    throw new Error('Can only update draft or planned invoices')
  }
  const introduction = await invoice.getIntroduction()
  const changes = $changes(invoice, { introduction })
  if (!changes.introduction) {
    throw new Error('Keine Änderungen')
  }
  introduction ? invoice.set('introduction', introduction) : invoice.unset('introduction')
  const audit = { user, fn: 'invoice-update', data: { changes } }
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('invoice-lex-sync', async ({ params: { id: invoiceId, resourceId: lexId } }) => {
  if (!invoiceId && !lexId) {
    throw new Error('Either id or resourceId is required.')
  }
  const query = $query(Invoice)
  invoiceId && query.equalTo('objectId', invoiceId)
  lexId && query.equalTo('lexId', lexId)
  const invoice = await query.first({ useMasterKey: true })
  if (!invoice) {
    throw new Error('Invoice not found')
  }
  const { voucherStatus } = await lexApi('/invoices/' + invoice.get('lexId'), 'GET')
  const changes = $changes(invoice, { voucherStatus })
  if (changes.voucherStatus) {
    invoice.set({ voucherStatus })
    const audit = { fn: 'invoice-update-lex', data: { changes } }
    await invoice.save(null, { useMasterKey: true, context: { audit } })
  }
  return invoice
}, { requireUser: true })

Parse.Cloud.define('invoice-recalculate-gradual-prices', async ({
  params: {
    id: invoiceId
  }, user, context: { seedAsId }
}) => {
  const invoice = await $getOrFail(Invoice, invoiceId)
  if (invoice.get('contract').get('pricingModel') !== 'gradual') {
    throw new Error('Only Staffelkonditionen invoices can be recalculated')
  }
  if (!invoice.get('periodStart')) {
    throw new Error('WHY NO PERIOD START?: ' + invoiceId)
  }
  const { gradualCount, gradualPrice } = await getPredictedCubeGradualPrice(invoice.get('contract'), invoice.get('periodStart'))
  return updateGradualInvoice(invoice, gradualCount, gradualPrice)
}, { requireUser: true })

Parse.Cloud.define('recalculate-gradual-invoices', async ({ params: { id: gradualId } }) => {
  consola.info('recalculating gradual invoices for ', gradualId)
  const gradualPriceMap = await $getOrFail('GradualPriceMap', gradualId)
  const contractsQuery = $query('Contract')
    .equalTo('gradualPriceMap', gradualPriceMap)
    .equalTo('pricingModel', 'gradual')
  const baseQuery = $query(Invoice)
    .matchesQuery('contract', contractsQuery)
    .notEqualTo('media', null)
    .lessThan('status', 2)
  const dates = await baseQuery
    .distinct('date')
    .then(dates => Promise.all(dates.map(async date => ({ date, gradualCount: await getGradualCubeCount(gradualPriceMap, date) }))))
  for (const { date, gradualCount } of dates) {
    await baseQuery
      .equalTo('date', date)
      .find({ useMasterKey: true })
      .then(invoices => Promise.all(invoices.map((invoice) => {
        const gradualPrice = getGradualPrice(gradualCount, gradualPriceMap.get('map'))
        return updateGradualInvoice(invoice, gradualCount, gradualPrice)
      })))
  }
  consola.success('recalculated gradual invoices')
}, { requireMaster: true })

module.exports = {
  getInvoiceTotals
}