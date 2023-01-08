const redis = require('./redis')

const headers = {
  Authorization: `Bearer ${process.env.LEX_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json'
}

const htmlEncode = val => val.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const lexApi = async (resourceurl, method = 'GET', body = {}) => Parse.Cloud.httpRequest({
  url: 'https://api.lexoffice.io/v1' + resourceurl,
  method,
  body,
  headers
})
  .catch((error) => {
    consola.info(resourceurl, method)
    if (error.status === 404) {
      throw new Error('Lexoffice Ressource nicht gefunden')
    }
    consola.error(error.status, error.data)
    throw new Error('LexApi error: ' + error.text)
  })
  .then(({ data }) => data)

const lexFile = async (documentId) => Parse.Cloud.httpRequest({
  url: 'https://api.lexoffice.io/v1/files/' + documentId,
  method: 'GET',
  headers
})

const getLexDocumentAttachment = (documentId) => {
  return {
    contentType: 'application/pdf',
    href: 'https://api.lexoffice.io/v1/files/' + documentId,
    httpHeaders: { Authorization: `Bearer ${process.env.LEX_ACCESS_TOKEN}` }
  }
}

const getSubscriptions = async () => Parse.Cloud.httpRequest({
  url: 'https://api.lexoffice.io/v1/event-subscriptions',
  method: 'GET',
  headers
}).then(response => response.data?.content)

const subscribe = async eventType => Parse.Cloud.httpRequest({
  url: 'https://api.lexoffice.io/v1/event-subscriptions',
  method: 'POST',
  headers,
  body: {
    eventType,
    callbackUrl: process.env.WEBHOOKS_URL + '/lex'
  }
})
  .catch(response => ({ eventType, ...response }))
  .then(response => ({ eventType, ...response.data }))

const unsubscribe = async subscriptionId => Parse.Cloud.httpRequest({
  url: 'https://api.lexoffice.io/v1/event-subscriptions/' + subscriptionId,
  method: 'DELETE',
  headers
})
  .catch((response) => {
    consola.error(response.data)
    return response
  })
  .then(response => response.data)

const clearSubscriptions = async () => {
  const subscriptions = await getSubscriptions()
  return Promise.all(subscriptions.map(({ subscriptionId }) => {
    return unsubscribe(subscriptionId)
  }))
}

const EVENTS = [
  // 'contact.created', // TODO: allow searching for / picking lex contact
  'contact.changed',
  // 'contact.deleted', // TODO: add a deleted from lex office flag
  'invoice.changed',
  // 'invoice.status.changed' unused because the invoice.changed gets triggered also
  'invoice.deleted',
  // 'payment.changed' ??
  'credit-note.changed',
  // 'credit-note.status.changed'  unused because the credit-note.changed gets triggered also
  'credit-note.deleted'
]

const ensureSubscriptions = async () => {
  const subscriptions = await getSubscriptions()
  const unsubscribedEvents = EVENTS.filter(eventType => !subscriptions.find(sub => sub.eventType === eventType))
  return Promise.all(unsubscribedEvents.map(subscribe))
    .then(events => EVENTS.reduce((acc, eventType) => {
      acc[eventType] = events.find(event => event.eventType === eventType) || subscriptions.find(sub => sub.eventType === eventType)
      return acc
    }, {}))
}

const getCountries = async () => {
  const cached = await redis.hgetall('countries')
  if (cached.length) {
    return cached
  }
  const countries = await Parse.Cloud.httpRequest({
    url: 'https://api.lexoffice.io/v1/countries',
    method: 'GET',
    headers
  }).then(response => response.data.filter((country) => {
    return country.taxClassification !== 'thirdPartyCountry'
  }))
  const items = {}
  for (const { countryCode, countryNameDE } of countries) {
    items[countryCode] = countryNameDE
  }
  await redis.hmset('countries', items)
  await redis.expire('countries', 60 * 60 * 24)
  return items
}

const getContacts = ({ params: { name, number } } = { name: {} }) => {
  return Parse.Cloud.httpRequest({
    url: 'https://api.lexoffice.io/v1/contacts',
    method: 'GET',
    headers,
    params: {
      name: name ? htmlEncode(name) : undefined,
      number
    }
  }).then(response => (response.data.content || []).map(item => ({
    id: item.id,
    customerNo: item.roles.customer?.number,
    name: item.company.name,
    allowTaxFreeInvoices: item.company.allowTaxFreeInvoices,
    version: item.version
  })))
}

Parse.Cloud.define('lex-contacts', getContacts, { requireUser: true })
Parse.Cloud.define('lex-contact-create', async ({ params: { name, allowTaxFreeInvoices } }) => {
  const { id } = await lexApi('/contacts', 'POST', {
    version: 0,
    roles: { customer: {} },
    company: { name, allowTaxFreeInvoices }
  })
  const contact = await lexApi('/contacts/' + id, 'GET')
  return {
    id,
    customerNo: contact.roles.customer.number,
    name,
    version: contact.version
  }
}, { requireUser: true })

Parse.Cloud.define('lex-subscriptions', getSubscriptions, { requireMaster: true })
Parse.Cloud.define('lex-subscribe', ({ params: { eventType } }) => subscribe(eventType), { requireMaster: true })
Parse.Cloud.define('lex-unsubscribe', ({ params: { subscriptionId } }) => unsubscribe(subscriptionId), { requireMaster: true })
Parse.Cloud.define('lex-clear', clearSubscriptions, { requireMaster: true })
Parse.Cloud.define('lex-ensure', ensureSubscriptions, { requireMaster: true })
Parse.Cloud.define('lex-countries', getCountries, { requireUser: true })

module.exports = lexApi
module.exports.lexApi = lexApi
module.exports.test = async () => {
  const subscriptions = await ensureSubscriptions()
  return EVENTS.every(eventType => !subscriptions[eventType].error)
}
module.exports.lexFile = lexFile
module.exports.getLexDocumentAttachment = getLexDocumentAttachment
module.exports.getCountries = getCountries
module.exports.getContacts = getContacts
module.exports.subscribe = subscribe
module.exports.ensureSubscriptions = ensureSubscriptions
module.exports.clearSubscriptions = clearSubscriptions
