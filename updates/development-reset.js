require('dotenv').config()
global.Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

async function initializeForDevelopment () {
  // sync lex accounts with dev lex
  await $query('Address').notEqualTo('lex', null).each(async (address) => {
    // check if address name exists on lexoffice
    let [lex] = await Parse.Cloud.run('lex-contacts', { name: address.get('name') }, { useMasterKey: true })
    if (!lex) {
      lex = await Parse.Cloud.run('lex-contact-create', {
        name: address.get('name'),
        allowTaxFreeInvoices: address.get('countryCode') !== 'DE' || undefined
      }, { useMasterKey: true })
      consola.info('created new lex', address.get('name'))
    } else {
      consola.success('found lex', address.get('name'))
    }
    return address.set({ lex }).save(null, { useMasterKey: true })
  }, { useMasterKey: true })
  consola.success()

  // update user passwords
  await $query(Parse.User).each(user => user.set('password', '123456').save(null, { useMasterKey: true }), { useMasterKey: true })
  consola.success('set user passwords')
}
initializeForDevelopment()
Parse.Config.save({ today: moment().format('YYYY-MM-DD') })
