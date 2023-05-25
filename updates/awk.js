require('dotenv').config()
global.Parse = require('parse/node')
// Parse.serverURL = process.env.PRODUCTION_SERVER_URL
Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

const { round2 } = require('./../src/utils')
const { isEqual } = require('lodash')

function normalizeAuditValue (value) {
  if (value === undefined || value === null) {
    return null
  }
  if (value?.toJSON) {
    value = value.toJSON()
  }
  if (value?.thumb && value.name) {
    return {
      name: value.name,
      url: value.thumb._url || value.thumb.url
    }
  }
  return value
}

const $changes = function (item, fields, rawObject = false) {
  const response = {}
  for (const key of Object.keys(fields)) {
    const oldValue = normalizeAuditValue(rawObject ? item[key] : item.get(key))
    const newValue = normalizeAuditValue(fields[key])
    if (!isEqual(oldValue, newValue)) {
      if (key !== 'form') {
        response[key] = [oldValue, newValue]
        continue
      }
      // this is for nested forms in objects (scout submissions)
      // when using the form the keys within the form should not exits in the fields
      for (const formKey of Object.keys(newValue)) {
        const oldFormValue = oldValue.form[formKey]
        const newFormValue = newValue.form[formKey]
        if (!isEqual(oldFormValue, newFormValue)) {
          response[formKey] = [oldFormValue, newFormValue]
        }
      }
    }
  }
  return response
}

async function start () {
  const awk = await $getOrFail('Company', 'NxOGWHJbXe')
  if (awk.get('distributor')?.pricingModel !== 'default') {
    await awk.set('distributor', { pricingModel: 'distributor' }).save(null, { useMasterKey: true })
    consola.info('SET AWK PRICING MODEL')
  }
  await $query('Booking')
    .equalTo('company', awk)
    .notEqualTo('endPrices', null)
    .each(async (booking) => {
      const endPrices = booking.get('endPrices')
      const monthlyMedia = {}
      for (const cubeId of Object.keys(endPrices)) {
        monthlyMedia[cubeId] = round2(0.4 * endPrices[cubeId])
      }
      const changes = $changes(booking, { endPrices, monthlyMedia })
      const audit = { fn: 'booking-update', data: { changes } }
      await booking
        .set({ endPrices: null, monthlyMedia })
        .save(null, { useMasterKey: true, context: { audit } })
      consola.success(booking.get('no'), endPrices, monthlyMedia)
    }, { useMasterKey: true })
}
start()
