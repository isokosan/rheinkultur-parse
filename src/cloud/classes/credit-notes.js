const { normalizeString, creditNotes: { normalizeFields } } = require('@/schema/normalizers')
const { getTaxRateOnDate } = require('@/shared')
const { round2, durationString } = require('@/utils')
const { lexApi, getLexDocumentAttachment } = require('@/services/lex')
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
      lines.push(`Buchungszeitraum: von ${start} bis ${end} (${duration} Monate)`)
    }
    const invoice = this.get('invoice')
    if (invoice) {
      if (!invoice.get('lexNo')) {
        await invoice.fetch({ useMasterKey: true })
      }
      lines.push(`Rechnungsnr.: ${invoice.get('lexNo')}`)
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
    const [periodStart, periodEnd] = [this.get('periodStart'), this.get('periodEnd')]
    if (periodStart && periodEnd) {
      const [start, end] = [periodStart, periodEnd]
        .map(dateString => moment(dateString).format('DD.MM.YYYY'))
      lines.push(`Gutschrift-Zeitraum: von ${start} bis ${end} (${durationString(periodEnd, periodStart)})`)
    }
    if (this.get('reason')) {
      lines.push(`Grund für Gutschrift: ${this.get('reason')}`)
    }
    return normalizeString(lines.join('\n'))
  }
})

// different cases
// agentur provision
// cubes entfallen von Buchung / Vertrag
// error inside a Rechnung
// late belegungstart (contract) OK
// special cases (custom)

function getCreditNoteTotals (lineItems, date) {
  let netTotal = 0
  for (const item of lineItems) {
    netTotal = round2(netTotal + item.price)
  }
  const taxTotal = round2(netTotal * getTaxRateOnDate(date) / 100)
  const total = round2(netTotal + taxTotal)
  return { netTotal, taxTotal, total }
}

async function getLexDocumentId (lexId) {
  return lexApi('/credit-notes/' + lexId + '/document', 'GET')
    .then(({ documentFileId }) => documentFileId)
}

Parse.Cloud.beforeFind(CreditNote, async ({ query }) => {
  query.include(['contract', 'invoice'])
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

  if (creditNote.isNew() || rewriteIntroduction) {
    creditNote.set('introduction', await creditNote.getIntroduction())
  }

  // total
  if (creditNote.get('status') < 2 && creditNote.get('lineItems')) {
    const { netTotal, taxTotal, total } = getCreditNoteTotals(creditNote.get('lineItems'), creditNote.get('date'))
    creditNote.set({ netTotal, taxTotal, total })
  }

  if (creditNote.get('lexId') && !creditNote.get('lexNo')) {
    const { voucherNumber, voucherStatus } = await lexApi('/credit-notes/' + creditNote.get('lexId'), 'GET')
    creditNote.set({ lexNo: voucherNumber, voucherStatus })
  }
})

Parse.Cloud.afterSave(CreditNote, ({ object: creditNote, context: { audit } }) => { $audit(creditNote, audit) })

Parse.Cloud.afterDelete(CreditNote, async ({ object: creditNote }) => {
  const contract = await $query('Contract').equalTo('lateStart.creditNote', creditNote).first({ useMasterKey: true })
  if (contract) {
    const lateStart = contract.get('lateStart')
    lateStart.creditNote = null
    contract.set({ lateStart })
    await contract.save(null, { useMasterKey: true })
  }
  $deleteAudits({ object: creditNote })
})

Parse.Cloud.define('credit-note-create', async ({ params, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }

  const {
    companyId,
    addressId,
    companyPersonId,
    contractId,
    bookingId,
    invoiceId,
    date,
    periodStart,
    periodEnd,
    lineItems
  } = normalizeFields(params)

  const creditNote = new CreditNote({
    status: 0,
    company: await $getOrFail('Company', companyId),
    address: await $getOrFail('Address', addressId),
    date,
    periodStart,
    periodEnd,
    lineItems,
    createdBy: user
  })
  companyPersonId && creditNote.set('companyPerson', await $getOrFail('Person', companyPersonId))
  creditNote.set({ tags: creditNote.get('company').get('tags') })
  contractId && creditNote.set('contract', await $getOrFail('Contract', contractId))
  bookingId && creditNote.set('booking', await $getOrFail('Booking', bookingId))
  invoiceId && creditNote.set('invoice', await $getOrFail('Invoice', invoiceId))

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
    lineItems,
    introduction
  } = normalizeFields(params)

  const creditNote = await $getOrFail(CreditNote, creditNoteId, ['address'])
  const changes = $changes(creditNote, {
    date,
    periodStart,
    periodEnd,
    introduction,
    lineItems
  })
  creditNote.set({
    date,
    periodStart,
    periodEnd,
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
  const creditNote = await $getOrFail(CreditNote, creditNoteId, ['company', 'address', 'companyPerson'])
  if (creditNote.get('status') > 1) {
    throw new Error('Can only issue draft or planned creditNotes')
  }
  if (moment(await $today()).isBefore(creditNote.get('date'), 'day')) {
    throw new Error('Can\'t issue future creditNote')
  }
  if (creditNote.get('total') === 0) {
    throw new Error('Can\'t issue 0€ creditNote')
  }

  const invoice = creditNote.get('invoice')
  if (invoice) {
    if (!invoice.get('date') || !invoice.get('lexNo')) {
      await invoice.fetch({ useMasterKey: true })
    }
  }

  const { lex, name, supplement, street, zip, city, countryCode } = creditNote.get('address').attributes
  if (!lex?.id) {
    throw new Error(`Die Abrechnungsaddresse ist noch nicht vollständig hinterlegt. Bitte überprüfen Sie die Stammdaten. (${invoice.id})`)
  }

  const { id: lexId, resourceUri: lexUri } = await lexApi('/credit-notes?finalize=true', 'POST', {
    archived: false,
    voucherDate: moment(creditNote.get('date'), 'YYYY-MM-DD').toDate(),
    address: {
      contactId: lex?.id,
      name,
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
          taxRatePercentage: lex.allowTaxFreeInvoices ? 0 : getTaxRateOnDate(creditNote.get('date'))
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
    remark: invoice
      ? [
        `Gutschrift zur Rechnung Nummer ${invoice.get('lexNo')} vom ${moment(invoice.get('date')).format('DD.MM.YYYY')}`,
        'Falls die Rechnung bereits gezahlt wurde, wird Ihnen der Betrag in den nächsten Tagen gutgeschrieben.'
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
    .then(() => { message += ` Email an ${email} gesendet.` })
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
    ...getLexDocumentAttachment(lexDocumentId)
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
  creditNote.set({ mailStatus })
  const audit = { fn: 'send-email', user, data: { mailStatus } }
  return creditNote.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('credit-note-discard', async ({ params: { id: creditNoteId }, user }) => {
  const creditNote = await $getOrFail(CreditNote, creditNoteId)
  if (creditNote.get('status') !== 1) {
    throw new Error('Can only discard planned creditNote')
  }
  const audit = { user, fn: 'credit-note-discard' }
  creditNote.set({ status: 4 })
  return creditNote.save(null, { useMasterKey: true, context: { audit } })
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
  const { voucherStatus } = await lexApi('/credit-notes/' + creditNote.get('lexId'), 'GET')
  const changes = $changes(creditNote, { voucherStatus })
  if (changes.voucherStatus) {
    creditNote.set({ voucherStatus })
    const audit = { fn: 'credit-note-update-lex', data: { changes } }
    await creditNote.save(null, { useMasterKey: true, context: { audit } })
  }
  return creditNote
}, { requireUser: true })

module.exports = {
  getCreditNoteTotals
}
