require('dotenv').config()
global.Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

async function initializeForDevelopment () {
  const today = moment().format('YYYY-MM-DD')
  await Parse.Config.save({ today })
  console.info('set today to', today)
  // update user passwords
  await $query(Parse.User).each(async (user) => {
    user.set('password', '123456')
    user.unset('logRocket')
    await user.save(null, { useMasterKey: true })
  }, { useMasterKey: true })
  console.info('set user passwords, unset logging')
  // sync lex accounts with dev lex
  await $query('Address').notEqualTo('lex', null).each(async (address) => {
    await new Promise(resolve => setTimeout(resolve, 200))
    // check if address name exists on lexoffice
    let [lex] = await Parse.Cloud.run('lex-contacts', { name: address.get('name').trim() }, { useMasterKey: true })
    if (!lex) {
      lex = await Parse.Cloud.run('lex-contact-create', {
        name: address.get('name'),
        allowTaxFreeInvoices: address.get('countryCode') !== 'DE' || undefined
      }, { useMasterKey: true })
      consola.info('created new lex', address.get('name'))
    } else {
      console.info('found existing lex', address.get('name'))
    }
    return address.set({ lex }).save(null, { useMasterKey: true })
  }, { useMasterKey: true })
  console.info('synced lex accounts with dev lex')
}
initializeForDevelopment()
