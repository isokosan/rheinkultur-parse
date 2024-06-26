const request = require('request')
const redis = require('@/services/redis')
const Authorization = `Bearer ${process.env.LEX_ACCESS_TOKEN}`
const headers = {
  Authorization,
  Accept: 'application/json',
  'Content-Type': 'application/json'
}
const callbackUrl = process.env.WEBHOOKS_URL + '/lex'

const htmlEncode = val => val.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const getLexRateLimiterLock = async (ms = 1000) => {
  while (await redis.get('lexoffice:rate-limit')) {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
  return redis.set('lexoffice:rate-limit', true, 'PX', 600)
}

const lexApi = async (resourceurl, method = 'GET', body = {}, retries = 0) => {
  await getLexRateLimiterLock()
  return new Promise((resolve, reject) => {
    return request({
      url: 'https://api.lexoffice.io/v1' + resourceurl,
      method,
      body,
      json: true,
      headers,
      timeout: 30000
    }, function (error, response, responseBody) {
      if (error) {
        if (error.status === 404) {
          return reject(new Error('Lexoffice Ressource nicht gefunden'))
        }
        consola.info(error, responseBody)
        return reject(new Error('LexApi error: ' + error.message))
      }
      if (responseBody.message === 'Rate limit exceeded') {
        if (retries > 2) {
          return reject(new Error('LexApi error: ' + responseBody.message))
        }
        retries++
        consola.warn('Lex Office rate limit reached, retrying:', retries)
        return lexApi(resourceurl, method, body, retries).then(resolve).catch(reject)
      }
      return resolve(responseBody)
    })
  })
}

const getLexFile = async (documentFileId) => {
  await getLexRateLimiterLock(300)
  return Parse.Cloud.httpRequest({
    url: 'https://api.lexoffice.io/v1/files/' + documentFileId,
    method: 'GET',
    headers: {
      Authorization,
      Accept: 'application/pdf'
    }
  })
}

const getLexInvoiceDocument = async (lexId) => {
  // Must be triggered to make sure lex has rendered the document
  await lexApi('/invoices/' + lexId + '/document', 'GET')
  return lexApi('/invoices/' + lexId, 'GET')
}

const getLexCreditNoteDocument = async (lexId) => {
  // Must be triggered to make sure lex has rendered the document
  await lexApi('/credit-notes/' + lexId + '/document', 'GET')
  return lexApi('/credit-notes/' + lexId, 'GET')
}

const getSubscriptions = async () => {
  await getLexRateLimiterLock(300)
  return Parse.Cloud.httpRequest({
    url: 'https://api.lexoffice.io/v1/event-subscriptions',
    method: 'GET',
    headers
  })
    .then(response => response.data?.content)
    .catch(error => {
      consola.error(error)
      throw new Error('Lexoffice unreachable')
    })
}

const subscribe = async eventType => {
  await getLexRateLimiterLock(300)
  return Parse.Cloud.httpRequest({
    url: 'https://api.lexoffice.io/v1/event-subscriptions',
    method: 'POST',
    headers,
    body: { eventType, callbackUrl }
  })
    .catch(response => ({ eventType, ...response }))
    .then(response => ({ eventType, ...response.data }))
}

const unsubscribe = async subscriptionId => {
  await getLexRateLimiterLock(300)
  return Parse.Cloud.httpRequest({
    url: 'https://api.lexoffice.io/v1/event-subscriptions/' + subscriptionId,
    method: 'DELETE',
    headers
  })
    .catch((response) => {
      consola.error(response.data)
      return response
    })
    .then(response => response.data)
}

const clearSubscriptions = async () => {
  const subscriptions = await getSubscriptions()
  return Promise.all(subscriptions.map(({ subscriptionId }) => {
    return unsubscribe(subscriptionId)
  }))
}

const EVENTS = [
  'contact.changed',
  // 'contact.deleted', // TODO: add a deleted from lex office flag
  'invoice.changed', // created, status.changed triggers this also
  'invoice.deleted',
  'credit-note.changed', // created, status.changed triggers this also
  'credit-note.deleted'
]

const ensureSubscriptions = async () => {
  const subscriptions = await getSubscriptions()
  const unsubscribedEvents = EVENTS.filter((eventType) => {
    const subscribed = subscriptions.find(sub => sub.eventType === eventType)
    return !subscribed || subscribed.callbackUrl !== callbackUrl
  })
  return Promise.all(unsubscribedEvents.map(subscribe))
    .then(events => EVENTS.reduce((acc, eventType) => {
      acc[eventType] = events.find(event => event.eventType === eventType) || subscriptions.find(sub => sub.eventType === eventType)
      return acc
    }, {}))
}

global.$countries = null

const fetchCountries = async () => {
  // set and retrieve countries from Parse.Config
  const config = await Parse.Config.get()
  if (config.get('countries')) { return config.get('countries') }
  await getLexRateLimiterLock()
  const countries = await Parse.Cloud.httpRequest({
    url: 'https://api.lexoffice.io/v1/countries',
    method: 'GET',
    headers
  }).then(response => response.data.filter((country) => {
    return country.taxClassification !== 'thirdPartyCountry'
  })).catch(error => {
    consola.error(error)
    throw new Error('Lexoffice unreachable')
  })
  const items = {}
  for (const { countryCode, countryNameDE } of countries) {
    items[countryCode] = countryNameDE
  }
  await Parse.Config.save({ countries: items })
  return items
}

const getCountries = async () => {
  if (!$countries) {
    $countries = await fetchCountries()
  }
  return $countries
}

const getContacts = async ({ params: { name, number } } = { name: {} }) => {
  await getLexRateLimiterLock()
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
  }))).catch(error => {
    consola.error(error)
    throw new Error('Lexoffice unreachable')
  })
}

Parse.Cloud.define('lex-contacts', getContacts, { requireUser: true })
Parse.Cloud.define('lex-contact-create', async ({ params: { name, allowTaxFreeInvoices } }) => {
  name = name.trim()
  // if the same name already exists, throw an error with already exists
  const contacts = await getContacts({ params: { name } })
  if (contacts.find(contact => contact.name.trim() === name)) {
    throw new Error('Lex-Kontakt mit dem Namen ' + name + ' existiert bereits.')
  }
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
module.exports.getLexFile = getLexFile
module.exports.getLexInvoiceDocument = getLexInvoiceDocument
module.exports.getLexCreditNoteDocument = getLexCreditNoteDocument
module.exports.getCountries = getCountries
module.exports.getContacts = getContacts
module.exports.subscribe = subscribe
module.exports.ensureSubscriptions = ensureSubscriptions
module.exports.clearSubscriptions = clearSubscriptions
