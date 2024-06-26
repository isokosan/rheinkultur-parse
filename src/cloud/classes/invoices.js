const { normalizeString, invoices: { normalizeFields } } = require('@/schema/normalizers')
const { ORDER_FIELDS, validateSystemStatus, getDocumentTotals, getTaxRatePercentage, getPeriodTotal } = require('@/shared')
const { round2, round5, priceString, durationString } = require('@/utils')
const { lexApi } = require('@/services/lex')
const { getPredictedCubeGradualPrice, getGradualPrice, getGradualCubeCount } = require('./gradual-price-maps')
const { sendBillingMail } = require('@/services/email')
const { addressAudit } = require('@/cloud/classes/addresses')

const { updateUnsyncedLexDocument } = require('@/cloud/system-status')

const getLexDocumentFileId = lexId => lexApi('/invoices/' + lexId + '/document', 'GET')
  .then(({ documentFileId }) => documentFileId)

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
    return [prefix, firstName, lastName].filter(Boolean).join(' ')
  },
  async getIntroduction () {
    const lines = []
    if (this.get('media')) {
      lines.push('Leistung: Dauerhinweiswerbung auf Schaltkasten (CityCube)')
    }
    const contract = this.get('contract')
    let orderDurationText
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
      orderDurationText = `Vertragszeitraum: von ${start} bis ${end} (${duration} Monate)`
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
      orderDurationText = `Buchungszeitraum: von ${start} bis ${end} (${duration} Monate)`
    }

    // if kinetic, add a few more custom lines
    if (this.get('company')?.id === 'FNFCxMgEEr') {
      await this.get('company').fetch({ useMasterKey: true })
      contract?.get('startsAt') && (orderDurationText = 'Rüsttermin: ' + moment(contract.get('startsAt')).format('DD.MM.YYYY'))
      lines.push(...[
        'Kunde: Telekom Deutschland GmbH',
        'Auftraggeber: ' + this.get('company').get('name'),
        'Produkt/Medium: CityCube',
        'Belegungsart:  Frontbelegung des jeweiligen Schaltschrankes'
      ])
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
      const label = (this.get('tags') || []).find(tag => tag.id === 'ALDI') ? 'Regionalgesellschaft' : 'Kampagnenname'
      lines.push(`${label}: ${campaignNo}`)
    }

    orderDurationText && lines.push(orderDurationText)
    const [periodStart, periodEnd] = [this.get('periodStart'), this.get('periodEnd')]
    if (periodStart && periodEnd) {
      const [start, end] = [periodStart, periodEnd]
        .map(dateString => moment(dateString).format('DD.MM.YYYY'))
      lines.push(`Abrechnungszeitraum: von ${start} bis ${end} (${durationString(periodEnd, periodStart)})`)
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

async function validateInvoiceDate (dateOfNewInvoice) {
  if (!dateOfNewInvoice) { throw new Error('Das Rechnungsdatum fehlt.') }
  if (moment(await $today()).isBefore(dateOfNewInvoice, 'day')) {
    throw new Error('Rechnungsdatum ist noch nicht erreicht.')
  }
  const lastIssuedInvoiceDate = await $query(Invoice)
    .notEqualTo('lexId', null)
    .descending('date')
    .select('date')
    .first({ useMasterKey: true })
    .then(invoice => invoice ? invoice.get('date') : null)
  if (lastIssuedInvoiceDate && moment(lastIssuedInvoiceDate).isAfter(dateOfNewInvoice, 'year')) {
    throw new Error('Sie können keine Rechnung für das vergangene Jahr ausstellen, wenn Sie bereits eine Rechnung für das neue Jahr ausgestellt haben.')
  }
}

function updateGradualInvoice (invoice, gradualCount, gradualPrice) {
  if (gradualCount === invoice.get('gradualCount') && gradualPrice === invoice.get('gradualPrice')) {
    return false
  }
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
  query.include(ORDER_FIELDS)
  if (query._include.includes('all')) {
    query.include([
      'company',
      'address',
      'docs'
    ])
  }
})

Parse.Cloud.beforeSave(Invoice, async ({ object: invoice, context: { rewriteIntroduction } }) => {
  invoice.get('status') === undefined && invoice.set('status', 0)
  invoice.get('voucherStatus') === 'voided' && invoice.set('status', 3)

  const address = invoice.get('address')
  if (!address) {
    throw new Error('You can\'t save an invoice without an address')
  }
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
    const agencyRatio = round5(invoice.get('commissionRate') / 100) || 0
    const net = round2(invoice.get('media')?.total * agencyRatio)
    invoice.set('commission', { net })
  }

  // dueDate
  invoice.set('dueDate', moment(invoice.get('date')).add(invoice.get('dueDays'), 'days').format('YYYY-MM-DD'))

  // total
  if (invoice.get('status') < 2 && invoice.get('lineItems')) {
    const { netTotal, taxTotal, total } = getDocumentTotals(invoice.get('address').get('lex').allowTaxFreeInvoices, invoice.get('lineItems'), invoice.get('date'))
    invoice.set({ netTotal, taxTotal, total })
  }

  if (invoice.get('lexId')) {
    if (!invoice.get('lexNo')) {
      const { voucherNumber, voucherStatus } = await lexApi('/invoices/' + invoice.get('lexId'), 'GET')
      invoice.set({ lexNo: voucherNumber, voucherStatus })
    }
    if (!invoice.get('lexDocumentFileId')) {
      invoice.set('lexDocumentFileId', await getLexDocumentFileId(invoice.get('lexId')))
    }
  }
})

Parse.Cloud.afterSave(Invoice, ({ object: invoice, context: { audit } }) => { $audit(invoice, audit) })

Parse.Cloud.beforeDelete(Invoice, ({ object: invoice }) => {
  if (invoice.get('lexId')) {
    throw new Error('Rechnungen, die mit lexoffice synchronisiert wurden, können nicht gelöscht werden.')
  }
})

Parse.Cloud.afterDelete(Invoice, $deleteAudits)

Parse.Cloud.define('invoice-create', async ({ params, user }) => {
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
}, $internOrAdmin)

Parse.Cloud.define('invoice-update', async ({ params: { id: invoiceId, ...params }, user }) => {
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
    changes.address = [invoice.get('address'), address].map(addressAudit)
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
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen') }
  const audit = { user, fn: 'invoice-update', data: { changes } }
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('invoice-update-extra-cols', async ({ params: { id: invoiceId, ...params }, user }) => {
  const { extraCols } = normalizeFields(params)
  const invoice = await $getOrFail(Invoice, invoiceId)
  const changes = $changes(invoice, { extraCols })
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen') }
  invoice.set({ extraCols })
  const audit = { user, fn: 'invoice-update', data: { changes } }
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('invoice-remove', async ({ params: { id: invoiceId } }) => {
  const invoice = await $getOrFail(Invoice, invoiceId)
  if ([1, 4].includes(invoice.get('status'))) {
    throw new Error('Auto-generated invoices cannot be deleted')
  }
  return invoice.destroy({ useMasterKey: true })
}, $internOrAdmin)

// email: true (the email defined in invoice address will be used if no skipInvoiceEmails on contract) | string (the custom email will be used) | false (no email will be send)
Parse.Cloud.define('invoice-issue', async ({ params: { id: invoiceId, email }, user }) => {
  let invoice = await $getOrFail(Invoice, invoiceId, ['company', 'address', 'companyPerson'])
  if (invoice.get('status') > 1 || invoice.get('voucherDate')) {
    throw new Error('Diese Rechnung wurde bereits ausgestellt.')
  }

  await validateInvoiceDate(invoice.get('date'))
  await validateSystemStatus()

  if (invoice.get('total') === 0) {
    throw new Error('Rechnungen mit einem Gesamtbetrag von 0€ können nicht ausgestellt werden.')
  }
  const { lex, supplement, street, zip, city, countryCode } = invoice.get('address').attributes
  if (!lex?.id) {
    throw new Error(`Die Abrechnungsaddresse ist noch nicht vollständig hinterlegt. Bitte überprüfen Sie die Stammdaten. (${invoice.id})`)
  }
  // recalculate if pricingModel is cubeCount
  if (invoice.get('media') && invoice.get('contract')?.get('pricingModel') === 'gradual') {
    await Parse.Cloud.run('invoice-recalculate-gradual-prices', { id: invoiceId }, { useMasterKey: true })
    invoice = await $getOrFail(Invoice, invoiceId, ['company', 'address', 'companyPerson'])
  }

  invoice.set('status', 1.5)
  const now = moment()
  const voucherDate = moment(invoice.get('date'), 'YYYY-MM-DD')
    .set({
      hour: now.get('hour'),
      minute: now.get('minute'),
      second: now.get('second'),
      millisecond: now.get('millisecond')
    })
    .toDate()
  invoice.set('voucherDate', voucherDate)
  if (email === true) {
    email = invoice.get('contract')?.get('skipInvoiceEmails')
      ? false
      : invoice.get('address').get('email')
  }
  email ? invoice.set('shouldMail', email) : invoice.unset('shouldMail')
  const audit = { user, fn: 'invoice-issue-request' }
  await invoice.save(null, { useMasterKey: true, context: { audit } })

  // HIT LEXOFFICE
  const { id: lexId, resourceUri: lexUri } = await lexApi('/invoices?finalize=true', 'POST', {
    archived: false,
    voucherDate,
    address: {
      contactId: lex.id,
      name: lex.name,
      supplement,
      street,
      zip,
      city,
      countryCode
    },
    lineItems: invoice.get('lineItems').map(item => ({
      type: 'custom',
      name: item.name,
      description: item.description,
      quantity: 1,
      unitName: 'Stück',
      unitPrice: {
        currency: 'EUR',
        netAmount: item.price,
        taxRatePercentage: getTaxRatePercentage(lex.allowTaxFreeInvoices, invoice.get('date'))
      },
      discountPercentage: 0
    })),
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

  if (!lexId || !lexUri) {
    consola.error('LexOffice hat die Rechnung nicht erstellt.', invoice.id)
    throw new Error('LexOffice hat die Rechnung nicht erstellt.')
  }

  invoice.set({ lexId, lexUri })
  invoice.set('status', 2).unset('shouldMail')
  await invoice.save(null, { useMasterKey: true, context: { audit: { user, fn: 'invoice-issue' } } })

  let message = 'Rechnung ausgestellt.'
  email && await Parse.Cloud.run('invoice-send-mail', { id: invoice.id, email }, { useMasterKey: true })
    .then((emailMessage) => { message += (' ' + emailMessage) })
    .catch((error) => invoice.save(null, { useMasterKey: true, context: { audit: { fn: 'send-email-error', data: { email, error: error.message } } } }))
  return message
}, $internOrAdmin)

Parse.Cloud.define('invoice-send-mail', async ({ params: { id: invoiceId, email }, user }) => {
  // TODO: Validate email
  if (!email) { throw new Error(`Bad email ${email}`) }
  const invoice = await $query(Invoice)
    .include(['company', 'docs'])
    .get(invoiceId, { useMasterKey: true })
  if (invoice.get('status') < 2 || !invoice.get('lexId') || !invoice.get('lexNo')) {
    throw new Error('Can\'t mail draft invoice')
  }
  const attachments = [{
    filename: invoice.get('lexNo') + '.pdf',
    contentType: 'application/pdf',
    href: process.env.EXPORTS_SERVER_URL + '/invoice-pdf?id=' + invoice.get('lexId'),
    httpHeaders: {
      'x-exports-master-key': process.env.EXPORTS_MASTER_KEY
    }
  }]
  if (invoice.get('media') || invoice.get('production')) {
    attachments.push({
      filename: invoice.get('lexNo') + ' Rechnungs-Standorte.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      href: process.env.EXPORTS_SERVER_URL + '/invoice-summary?id=' + invoice.id,
      httpHeaders: {
        'x-exports-master-key': process.env.EXPORTS_MASTER_KEY
      }
    })
  }
  for (const doc of invoice.get('docs') || []) {
    attachments.push({
      filename: doc.get('name'),
      contentType: doc.get('contentType'),
      href: doc.get('file')._url
    })
  }
  const mailStatus = await sendBillingMail({
    to: email,
    subject: `Rechnung ${invoice.get('lexNo')}`,
    template: 'invoice',
    variables: {
      invoice: invoice.toJSON(),
      company: invoice.get('company').toJSON()
    },
    attachments
  })
  if (mailStatus.accepted.length === 0) {
    throw new Error('E-Mail konnte nicht verschickt werden. Bitte prüfen Sie die E-Mail Adresse.')
  }
  mailStatus.attachments = attachments.map(attachment => attachment.filename)
  invoice.set({ mailStatus })
  const audit = { fn: 'send-email', user, data: { mailStatus } }
  await invoice.save(null, { useMasterKey: true, context: { audit } })
  return `E-mail an ${email} gesendet.`
}, $internOrAdmin)

Parse.Cloud.define('invoice-toggle-post', async ({ params: { id: invoiceId }, user }) => {
  const invoice = await $getOrFail(Invoice, invoiceId)
  if (invoice.get('status') < 2) {
    throw new Error('Rechnung muss abgeschlossen sein.')
  }
  const postStatus = invoice.get('postStatus') ? null : { sentAt: moment().format('YYYY-MM-DD') }
  const message = 'Rechnung als ' + (invoice.get('postStatus') ? 'nicht ' : '') + 'versendet markiert'
  invoice.set({ postStatus })
  const audit = { user, fn: 'toggle-post', data: { postStatus } }
  await invoice.save(null, { useMasterKey: true, context: { audit } })
  return message
}, $internOrAdmin)

Parse.Cloud.define('invoice-discard', async ({ params: { id: invoiceId }, user, context: { audit: predefinedAudit } }) => {
  const invoice = await $getOrFail(Invoice, invoiceId)
  if (invoice.get('status') !== 1) {
    throw new Error('Nur geplante Rechnungen können verworfen werden.')
  }
  const audit = predefinedAudit || { user, fn: 'invoice-discard' }
  invoice.set({ status: 4 })
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('invoice-reset-introduction', async ({ params: { id: invoiceId }, user }) => {
  const invoice = await $getOrFail(Invoice, invoiceId, ['contract', 'booking'])
  if (invoice.get('status') > 1) {
    throw new Error('Can only update draft or planned invoices')
  }
  const introduction = await invoice.getIntroduction()
  const changes = $changes(invoice, { introduction })
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen') }
  introduction ? invoice.set('introduction', introduction) : invoice.unset('introduction')
  const audit = { user, fn: 'invoice-update', data: { changes } }
  return invoice.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('invoice-sync-lex', async ({ params: { resourceId: lexId, unsetDocument } }) => {
  if (!lexId) { throw new Error('resourceId is required.') }
  const resource = await lexApi('/invoices/' + lexId, 'GET')
  let invoice = await $query(Invoice).equalTo('lexId', lexId).first({ useMasterKey: true })
  // handle new invoice if not found
  if (!invoice) {
    if (resource.voucherStatus === 'draft') {
      consola.info('aborting invoice import because new invoice is not finalized')
      return
    }
    // wait here 5 seconds to make sure the invoice is finalized
    await new Promise(resolve => setTimeout(resolve, 5000))
    invoice = await $query(Invoice)
      .equalTo('voucherDate', moment(resource.voucherDate).toDate())
      .first({ useMasterKey: true })
    if (invoice) {
      if (invoice.get('status') === 2) {
        return 'Invoice already issued and saved into WaWi'
      }
      invoice.set({ lexId, lexUri: resource.resourceUri })
      const email = invoice.get('shouldMail')
      invoice.set('status', 2).unset('shouldMail')
      const audit = { fn: 'invoice-issue-lex' }
      await invoice.save(null, { useMasterKey: true, context: { audit } })
      return email && Parse.Cloud.run('invoice-send-mail', { id: invoice.id, email }, { useMasterKey: true })
        .catch((error) => invoice.save(null, { useMasterKey: true, context: { audit: { fn: 'send-email-error', data: { email, error: error.message } } } }))
    }
    // otherwise save the invoice as UnsyncedLexDocument
    return updateUnsyncedLexDocument('Invoice', resource)
  }
  const {
    voucherStatus,
    totalPrice: {
      totalNetAmount: netTotal,
      totalTaxAmount: taxTotal,
      totalGrossAmount: total
    }
  } = resource
  const changes = $changes(invoice, { voucherStatus, netTotal, taxTotal, total })
  if (Object.keys(changes).length) {
    invoice.set({ voucherStatus, netTotal, taxTotal, total }).unset('lexDocumentFileId')
    const audit = { fn: 'invoice-update-lex', data: { changes } }
    await invoice.save(null, { useMasterKey: true, context: { audit } })
  } else if (unsetDocument) {
    await invoice.unset('lexDocumentFileId').save(null, { useMasterKey: true })
  }
  return invoice
}, $internOrAdmin)

Parse.Cloud.define('invoice-delete-lex', async ({ params: { resourceId: lexId } }) => {
  if (!lexId) { throw new Error('resourceId is required.') }
  // TODO: if invoice exists, set lexId to null
  return $query('UnsyncedLexDocument')
    .equalTo('type', 'Invoice')
    .equalTo('lexId', lexId)
    .each(doc => doc.destroy({ useMasterKey: true }), { useMasterKey: true })
}, { requireMaster: true })

Parse.Cloud.define('invoice-recalculate-gradual-prices', async ({
  params: {
    id: invoiceId
  }, user
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
}, $internOrAdmin)

Parse.Cloud.define('recalculate-gradual-invoices', async ({ params: { id: gradualId } }) => {
  consola.info(`Recalculating gradual invoices for ${gradualId}`)
  let i = 0
  const gradualPriceMap = await $getOrFail('GradualPriceMap', gradualId)
  const contractsQuery = $query('Contract')
    .equalTo('gradualPriceMap', gradualPriceMap)
    .equalTo('pricingModel', 'gradual')
  const dates = await $query(Invoice)
    .matchesQuery('contract', contractsQuery)
    .notEqualTo('media', null)
    .containedIn('status', [0, 1, 4])
    .distinct('date')
    .then(dates => Promise.all(dates.map(async date => ({ date, gradualCount: await getGradualCubeCount(gradualPriceMap, date) }))))
  for (const { date, gradualCount } of dates) {
    const gradualPrice = getGradualPrice(gradualCount, gradualPriceMap.get('map'))
    let skip = 0
    while (true) {
      const invoices = await $query(Invoice)
        .matchesQuery('contract', contractsQuery)
        .notEqualTo('media', null)
        .containedIn('status', [0, 1, 4])
        .equalTo('date', date)
        .skip(skip)
        .find({ useMasterKey: true })
      if (!invoices.length) { break }
      for (const invoice of invoices) {
        await updateGradualInvoice(invoice, gradualCount, gradualPrice) && (i++)
      }
      skip += invoices.length
    }
  }
  return i
}, { requireMaster: true })
