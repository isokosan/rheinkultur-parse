const { addresses: { normalizeFields, UNSET_NULL_FIELDS } } = require('@/schema/normalizers')
const { lexApi, getCountries } = require('@/services/lex')

const Address = Parse.Object.extend('Address')

Parse.Cloud.beforeSave(Address, async ({ object: address }) => {
  UNSET_NULL_FIELDS.forEach(field => !address.get(field) && address.unset(field))
  const countryCode = address.get('countryCode')
  if (countryCode) {
    const countries = await getCountries()
    if (!countries[countryCode]) {
      throw new Error(`Country ${countryCode} is not recognized.`)
    }
  }
  address.get('lex') && address.set('name', address.get('lex').name)
})

Parse.Cloud.afterSave(Address, async ({ object: address, context: { audit } }) => { $audit(address.get('company'), audit) })

Parse.Cloud.beforeDelete(Address, async ({ object: address }) => {
  // check primaryAddress / secondaryAddress
  const company = address.get('company')
  await company.fetch({ useMasterKey: true })
  if (company.get('address')?.id === address.id) {
    throw new Error('Please unset as primary address before deleting it.')
  }
  if (company.get('invoiceAddress')?.id === address.id) {
    throw new Error('Please unset as primary invoice address before deleting it.')
  }
  // check all contracts
  // check all invoices
  // check all creditNotes
  await Promise.all([
    $query('Contract').equalTo('address', address),
    $query('Contract').equalTo('invoiceAddress', address),
    $query('Invoice').equalTo('address', address),
    $query('CreditNote').equalTo('address', address)
  ].map(async query => {
    const count = await query.count({ useMasterKey: true })
    if (count) {
      throw new Error('Address is used in a contract, invoice or credit note.')
    }
  }))
})

Parse.Cloud.afterDelete(Address, async ({ object: address, context: { audit } }) => { $audit(address.get('company'), audit) })

Parse.Cloud.afterFind(Address, ({ objects: addresses }) => {
  for (const address of addresses) {
    address.set('address', address.get('street') + ', ' + address.get('zip') + ' ' + address.get('city'))
  }
})

Parse.Cloud.define('address-save', async ({ params: { id: addressId, ...params }, user }) => {
  const {
    lex,
    companyId,
    name,
    supplement,
    street,
    zip,
    city,
    countryCode,
    pbx,
    email
  } = normalizeFields(params)

  if (!addressId) {
    const address = new Address({
      company: await $getOrFail('Company', companyId),
      lex,
      name,
      supplement,
      street,
      zip,
      city,
      countryCode,
      pbx,
      email,
      importNo: params.importNo
    })
    const audit = { user, fn: 'address-create', data: { name } }
    return address.save(null, { useMasterKey: true, context: { audit } })
  }
  const address = await $getOrFail(Address, addressId)
  const changes = $changes(address, { name, supplement, street, zip, city, countryCode, pbx, email })
  address.set({
    lex,
    name,
    supplement,
    street,
    zip,
    city,
    countryCode,
    pbx,
    email
  })
  const audit = { user, fn: 'address-update', data: { name, changes } }
  return address.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('address-set-primary', async ({ params: { id: addressId, invoice }, user }) => {
  const address = await $getOrFail(Address, addressId, ['company'])
  const { name } = address.toJSON()
  const company = address.get('company')
  let fn = invoice ? 'invoice-address-' : 'address-'
  let message = invoice ? 'Rechnungsaddresse' : 'Primary address'
  const field = invoice ? 'invoiceAddress' : 'address'
  if (company.get(field)?.id === addressId) {
    company.unset(field)
    fn += 'unset-primary'
    message += ' unset as primary'
  } else {
    company.set(field, address)
    fn += 'set-primary'
    message += ' set as primary'
  }
  const audit = { user, fn, data: { name } }
  await company.save(null, { useMasterKey: true, context: { audit } })
  return message
}, $internOrAdmin)

Parse.Cloud.define('address-delete', async ({ params: { id: addressId }, user }) => {
  const address = await $getOrFail(Address, addressId)
  const { name } = address.toJSON()
  const audit = { user, fn: 'address-delete', data: { name } }
  return address.destroy({ useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('address-sync-lex', async ({ params: { resourceId, force } }) => {
  if (!resourceId) { throw new Error('resourceId is required.') }
  const lexContact = await lexApi('/contacts/' + resourceId, 'GET')
  const { name } = lexContact.company
  const allowTaxFreeInvoices = lexContact.company.allowTaxFreeInvoices ? true : null
  let i = 0
  const query = $query(Address).equalTo('lex.id', resourceId)
  !force && query.notEqualTo('lex.version', lexContact.version)
  await query.each(async address => {
    const changes = $changes(address, { name, allowTaxFreeInvoices })
    const audit = { fn: 'address-update-lex', data: { name, changes } }
    address.set('name', name)
    address.set('lex', {
      id: resourceId,
      name,
      allowTaxFreeInvoices,
      customerNo: lexContact.roles.customer.number,
      version: lexContact.version
    })
    await address.save(null, { useMasterKey: true, context: { audit } })
    i++
  }, { useMasterKey: true })
  return i
}, {
  requireMaster: true,
  fields: {
    resourceId: {
      type: String,
      required: true
    }
  }
})

module.exports.addressAudit = (address) => {
  if (!address) { return null }
  return [address.get('name'), address.get('street'), address.get('zip'), address.get('city')].filter(Boolean).join(' ')
}
