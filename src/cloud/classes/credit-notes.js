/*
  Required info for reports:
  => Invoice (for agency rates)
  => Cube (for regional comissions)
 */

const { normalizeString, creditNotes: { normalizeFields } } = require('@/schema/normalizers')
const { getDocumentTotals, getTaxRatePercentage } = require('@/shared')
const { durationString } = require('@/utils')
const { lexApi, getLexFileAsAttachment } = require('@/services/lex')
const sendMail = require('@/services/email')

const CreditNote = Parse.Object.extend('CreditNote', {
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
    if (contract?.get('invoiceDescription')) {
      lines.push(contract.get('invoiceDescription'))
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
    const company = this.get('company')
    !company.get('name') && await company.fetch({ useMasterKey: true })
    if (company.get('name') === 'Kinetic Germany GmbH') {
      contract?.get('startsAt') && (orderDurationText = 'Rüsttermin: ' + moment(contract.get('startsAt')).format('DD.MM.YYYY'))
      lines.push(...[
        'Kunde: Telekom Deutschland GmbH',
        'Auftraggeber: Kinetic Germany GmbH',
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
      const label = (this.get('tags') || []).find(tag => tag.id === 'ALDI') ? 'Regionalgesellschaft' : 'Kampagnennr.'
      lines.push(`${label}: ${campaignNo}`)
    }

    orderDurationText && lines.push(orderDurationText)
    const [periodStart, periodEnd] = [this.get('periodStart'), this.get('periodEnd')]
    if (periodStart && periodEnd) {
      const [start, end] = [periodStart, periodEnd]
        .map(dateString => moment(dateString).format('DD.MM.YYYY'))
      lines.push(`Gutschrift-Zeitraum: von ${start} bis ${end} (${durationString(periodEnd, periodStart)})`)
    }
    lines.push(`Grund der Gutschrift: ${this.get('reason') || ''}`)
    return normalizeString(lines.join('\n'))
  }
})

// different cases
// agentur provision
// cubes entfallen von Buchung / Vertrag
// error inside a Rechnung
// late belegungstart (contract) OK
// special cases (custom)

async function validateCreditNoteDate (dateOfNewCreditNote) {
  if (!dateOfNewCreditNote) { throw new Error('Es fehlt das Datum der Gutschrift.') }
  if (moment(await $today()).isBefore(dateOfNewCreditNote, 'day')) {
    throw new Error('Das Datum der Gutschrift ist noch nicht erreicht.')
  }
  const lastIssuedCreditNoteDate = await $query(CreditNote)
    .notEqualTo('lexId', null)
    .descending('date')
    .select('date')
    .first({ useMasterKey: true })
    .then(creditNote => creditNote ? creditNote.get('date') : null)
  if (lastIssuedCreditNoteDate && moment(lastIssuedCreditNoteDate).isAfter(dateOfNewCreditNote, 'year')) {
    throw new Error('Sie können keine Gutschrift für das vergangene Jahr ausstellen, wenn Sie bereits eine Gutschrift für das neue Jahr ausgestellt haben.')
  }
}

// Need to fetch documents here, as otherwise Lex might not generate the document
async function getLexDocumentId (lexId) {
  return lexApi('/credit-notes/' + lexId + '/document', 'GET')
    .then(({ documentFileId }) => documentFileId)
}

Parse.Cloud.beforeFind(CreditNote, async ({ query }) => {
  query.include(['contract', 'invoices'])
  if (query._include.includes('all')) {
    query.include([
      'company',
      'address',
      'contract',
      'bookings',
      'booking',
      'docs'
    ])
  }
})

Parse.Cloud.beforeSave(CreditNote, async ({ object: creditNote, context: { rewriteIntroduction } }) => {
  creditNote.get('status') === undefined && creditNote.set('status', 0)
  creditNote.get('voucherStatus') === 'voided' && creditNote.set('status', 3)

  const address = creditNote.get('address')
  if (!address) {
    throw new Error('You can\'t save a credit note without an address')
  }
  if (!address.get('lex')) {
    await address.fetch({ useMasterKey: true })
    if (!address.get('lex')) {
      throw new Error('Gutschriftsaddresse muss auf LexOffice gespeichert sein')
    }
  }

  if (creditNote.isNew() || rewriteIntroduction) {
    creditNote.set('introduction', await creditNote.getIntroduction())
  }

  // total
  if (creditNote.get('status') < 2 && creditNote.get('lineItems')) {
    const { netTotal, taxTotal, total } = getDocumentTotals(creditNote.get('address').get('lex').allowTaxFreeInvoices, creditNote.get('lineItems'), creditNote.get('date'))
    creditNote.set({ netTotal, taxTotal, total })
  }

  if (creditNote.get('lexId') && !creditNote.get('lexNo')) {
    const { voucherNumber, voucherStatus } = await lexApi('/credit-notes/' + creditNote.get('lexId'), 'GET')
    creditNote.set({ lexNo: voucherNumber, voucherStatus })
  }
})

Parse.Cloud.afterSave(CreditNote, ({ object: creditNote, context: { audit } }) => { $audit(creditNote, audit) })

Parse.Cloud.afterDelete(CreditNote, $deleteAudits)

Parse.Cloud.define('credit-note-create', async ({ params, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const {
    companyId,
    addressId,
    companyPersonId,
    contractId,
    bookingId,
    invoiceIds,
    date,
    periodStart,
    periodEnd,
    mediaItems,
    lineItems
  } = normalizeFields(params)

  const creditNote = new CreditNote({
    status: 0,
    company: await $getOrFail('Company', companyId),
    address: await $getOrFail('Address', addressId),
    date,
    periodStart,
    periodEnd,
    mediaItems,
    lineItems,
    createdBy: user
  })
  companyPersonId && creditNote.set('companyPerson', await $getOrFail('Person', companyPersonId))
  creditNote.set({ tags: creditNote.get('company').get('tags') })
  contractId && creditNote.set('contract', await $getOrFail('Contract', contractId))
  bookingId && creditNote.set('booking', await $getOrFail('Booking', bookingId))
  invoiceIds && creditNote.set('invoices', await Promise.all(invoiceIds.map(id => $getOrFail('Invoice', id))))

  const audit = { user, fn: 'credit-note-create' }
  return creditNote.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('credit-note-update', async ({ params: { id: creditNoteId, ...params }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const {
    companyId,
    addressId,
    companyPersonId,
    date,
    periodStart,
    periodEnd,
    mediaItems,
    lineItems,
    introduction
  } = normalizeFields(params)

  const creditNote = await $getOrFail(CreditNote, creditNoteId, ['address'])
  const changes = $changes(creditNote, {
    date,
    periodStart,
    periodEnd,
    mediaItems,
    introduction,
    lineItems
  })
  creditNote.set({
    date,
    periodStart,
    periodEnd,
    mediaItems,
    introduction,
    lineItems
  })

  if (companyId !== creditNote.get('company')?.id) {
    changes.companyId = [creditNote.get('company')?.id, companyId]
    creditNote.set({ company: await $getOrFail('Company', companyId) })
  }
  if (addressId !== creditNote.get('address')?.id) {
    const address = addressId ? await $getOrFail('Address', addressId) : null
    changes.address = [creditNote.get('address')?.get('name'), address?.get('name')]
    address ? creditNote.set({ address }) : creditNote.unset('address')
  }
  if (companyPersonId !== creditNote.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [creditNote.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    companyPerson ? creditNote.set({ companyPerson }) : creditNote.unset('companyPerson')
  }
  const audit = { user, fn: 'credit-note-update', data: { changes } }
  return creditNote.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('credit-note-reset-introduction', async ({ params: { id: creditNoteId }, user }) => {
  const creditNote = await $getOrFail(CreditNote, creditNoteId, ['contract', 'booking'])
  if (creditNote.get('status') > 1) {
    throw new Error('Can only update draft or planned credit notes')
  }
  const introduction = await creditNote.getIntroduction()
  const changes = $changes(creditNote, { introduction })
  if (!changes.introduction) {
    throw new Error('Keine Änderungen')
  }
  introduction ? creditNote.set('introduction', introduction) : creditNote.unset('introduction')
  const audit = { user, fn: 'credit-note-update', data: { changes } }
  return creditNote.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('credit-note-remove', async ({ params: { id: creditNoteId } }) => {
  const creditNote = await $getOrFail(CreditNote, creditNoteId)
  if (creditNote.get('status')) {
    throw new Error('Only draft credit notes can be removed')
  }
  if (creditNote.get('lexId')) {
    throw new Error('CreditNotes synced to lexoffice cannot be deleted')
  }
  return creditNote.destroy({ useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('credit-note-issue', async ({ params: { id: creditNoteId, email }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }
  const creditNote = await $getOrFail(CreditNote, creditNoteId, ['company', 'address', 'companyPerson', 'invoices'])
  if (creditNote.get('status') > 1) {
    throw new Error('Can only issue draft or planned creditNotes')
  }

  await validateCreditNoteDate(creditNote.get('date'))

  if (creditNote.get('total') === 0) {
    throw new Error('Can\'t issue 0€ creditNote')
  }

  const { lex, supplement, street, zip, city, countryCode } = creditNote.get('address').attributes
  if (!lex?.id) {
    throw new Error(`Die Abrechnungsaddresse ist noch nicht vollständig hinterlegt. Bitte überprüfen Sie die Stammdaten. (${creditNote.id})`)
  }

  const { id: lexId, resourceUri: lexUri } = await lexApi('/credit-notes?finalize=true', 'POST', {
    archived: false,
    voucherDate: moment(creditNote.get('date'), 'YYYY-MM-DD').toDate(),
    address: {
      contactId: lex.id,
      name: lex.name,
      supplement,
      street,
      zip,
      city,
      countryCode
    },
    lineItems: creditNote.get('lineItems').map((item) => {
      return {
        type: 'custom',
        name: item.name,
        description: item.description,
        quantity: 1,
        unitName: 'Stück',
        unitPrice: {
          currency: 'EUR',
          netAmount: item.price,
          taxRatePercentage: getTaxRatePercentage(lex.allowTaxFreeInvoices, creditNote.get('date'))
        },
        discountPercentage: 0
      }
    }),
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType: 'net' },
    shippingConditions: {
      shippingType: 'none'
    },
    title: 'Gutschrift',
    introduction: creditNote.get('introduction'),
    remark: creditNote.get('invoices')
      ? [
        `Gutschrift zur Rechnung(en): ${creditNote.get('invoices').map(inv => `${inv.get('lexNo')} vom ${moment(inv.get('date')).format('DD.MM.YYYY')}`).join(', ')}`,
        'Falls die Rechnungen bereits gezahlt wurden, wird Ihnen der Betrag in den nächsten Tagen gutgeschrieben.'
      ].join('\n\n')
      : 'Der Betrag wird Ihnen in den nächsten Tagen gutgeschrieben.'
  })
  creditNote.set({ lexId, lexUri })
  creditNote.set('status', 2)
  const audit = { user, fn: 'credit-note-issue' }
  await creditNote.save(null, { useMasterKey: true, context: { audit } })

  let message = 'Rechnung ausgestellt.'
  if (email === true) {
    email = creditNote.get('address').email
  }

  email && await Parse.Cloud.run('credit-note-send-mail', { id: creditNote.id, email }, { useMasterKey: true })
    .then((emailMessage) => { message += (' ' + emailMessage) })
    .catch(consola.error)
  return message
}, { requireUser: true })

Parse.Cloud.define('credit-note-send-mail', async ({ params: { id: creditNoteId, email }, user }) => {
  if (!email) {
    throw new Error(`Bad email ${email}`)
  }
  const creditNote = await $query(CreditNote)
    .include(['company', 'docs'])
    .get(creditNoteId, { useMasterKey: true })
  if (creditNote.get('status') < 2) {
    throw new Error('Can\'t mail draft creditNote')
  }
  const attachments = []
  const lexDocumentId = await getLexDocumentId(creditNote.get('lexId'))
  lexDocumentId && attachments.push({
    filename: creditNote.get('lexNo') + '.pdf',
    ...getLexFileAsAttachment(lexDocumentId)
  })
  for (const doc of creditNote.get('docs') || []) {
    attachments.push({
      filename: doc.get('name'),
      contentType: doc.get('contentType'),
      href: doc.get('file')._url
    })
  }
  const mailStatus = await sendMail({
    to: email,
    subject: `Gutschrift ${creditNote.get('lexNo')}`,
    template: 'credit-note',
    variables: {
      creditNote: creditNote.toJSON(),
      company: creditNote.get('company').toJSON()
    },
    attachments
  })
  mailStatus.attachments = attachments.map(attachment => attachment.filename)
  creditNote.set({ mailStatus })
  const audit = { fn: 'send-email', user, data: { mailStatus } }
  await creditNote.save(null, { useMasterKey: true, context: { audit } })
  return `E-mail an ${email} gesendet.`
}, { requireUser: true })

Parse.Cloud.define('credit-note-toggle-post', async ({ params: { id: creditNoteId }, user }) => {
  const creditNote = await $getOrFail(CreditNote, creditNoteId)
  if (creditNote.get('status') < 2) {
    throw new Error('Can\'t post draft credit note')
  }
  const postStatus = creditNote.get('postStatus') ? null : { sentAt: moment().format('YYYY-MM-DD') }
  const message = 'Rechnung als ' + (creditNote.get('postStatus') ? 'nicht ' : '') + 'versendet markiert'
  creditNote.set({ postStatus })
  const audit = { user, fn: 'toggle-post', data: { postStatus } }
  await creditNote.save(null, { useMasterKey: true, context: { audit } })
  return message
}, { requireUser: true })

Parse.Cloud.define('credit-note-sync-lex', async ({ params: { id: creditNoteId, resourceId: lexId } }) => {
  if (!creditNoteId && !lexId) {
    throw new Error('Either id or resourceId is required.')
  }
  const query = $query(CreditNote)
  creditNoteId && query.equalTo('objectId', creditNoteId)
  lexId && query.equalTo('lexId', lexId)
  const creditNote = await query.first({ useMasterKey: true })
  if (!creditNote) {
    throw new Error('CreditNote not found')
  }
  const {
    voucherStatus,
    totalPrice: {
      totalNetAmount: netTotal,
      totalTaxAmount: taxTotal,
      totalGrossAmount: total
    }
  } = await lexApi('/credit-notes/' + creditNote.get('lexId'), 'GET')
  const changes = $changes(creditNote, { voucherStatus, netTotal, taxTotal, total })
  if (Object.keys(changes).length) {
    creditNote.set({ voucherStatus, netTotal, taxTotal, total })
    const audit = { fn: 'credit-note-update-lex', data: { changes } }
    await creditNote.save(null, { useMasterKey: true, context: { audit } })
  }
  return creditNote
}, { requireUser: true })
