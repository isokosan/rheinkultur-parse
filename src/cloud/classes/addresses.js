const { addresses: { normalizeFields, UNSET_NULL_FIELDS } } = require('@/schema/normalizers')
const redis = require('@/services/redis')
const lexApi = require('@/services/lex')

const Address = Parse.Object.extend('Address')

Parse.Cloud.beforeSave(Address, async ({ object: address }) => {
  UNSET_NULL_FIELDS.forEach(field => !address.get(field) && address.unset(field))
  const countryCode = address.get('countryCode')
  if (countryCode) {
    const exists = await redis.hexists('countries', countryCode)
    if (!exists) {
      throw new Error(`Country ${countryCode} is not recognized.`)
    }
  }
})

Parse.Cloud.afterSave(Address, async ({ object: address, context: { audit } }) => { $audit(address.get('company'), audit) })
Parse.Cloud.afterDelete(Address, async ({ object: address, context: { audit } }) => { $audit(address.get('company'), audit) })

Parse.Cloud.afterFind(Address, ({ objects: addresses }) => {
  for (const address of addresses) {
    address.set('address', address.get('street') + ', ' + address.get('zip') + ' ' + address.get('city'))
  }
})

Parse.Cloud.define('address-save', async ({ params: { id: addressId, ...params }, user, context: { seedAsId } }) => {
  if (seedAsId) { user = $parsify(Parse.User, seedAsId) }
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
}, { requireUser: true })

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
}, { requireUser: true })

Parse.Cloud.define('address-delete', async ({ params: { id: addressId }, user }) => {
  const address = await $getOrFail(Address, addressId)
  const { name } = address.toJSON()
  const audit = { user, fn: 'address-delete', data: { name } }
  return address.destroy({ useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('address-sync-lex', async ({ params: { resourceId } }) => {
  if (!resourceId) {
    throw new Error('resourceId is required.')
  }
  const lexContact = await lexApi('/contacts/' + resourceId, 'GET')
  const { name, allowTaxFreeInvoices } = lexContact.company
  let i = 0
  while (true) {
    const addresses = await $query(Address)
      .equalTo('lex.id', resourceId)
      .notEqualTo('lex.version', lexContact.version)
      .find({ useMasterKey: true })
    if (!addresses.length) {
      break
    }
    i += addresses.length
    for (const address of addresses) {
      const changes = $changes(address, { name, allowTaxFreeInvoices })
      const audit = { fn: 'address-update-lex', data: { name, allowTaxFreeInvoices, changes } }
      address.set('lex', {
        id: resourceId,
        name,
        allowTaxFreeInvoices,
        customerNo: lexContact.roles.customer.number,
        version: lexContact.version
      })
      await address.save(null, { useMasterKey: true, context: { audit } })
    }
  }
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