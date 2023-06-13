const express = require('express')
const Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)

const router = express.Router()
router.use(express.json())

router.post('/lex', async (req, res) => {
  consola.info('webhook triggered', req.body)
  const { eventType, resourceId } = req.body
  if (!resourceId) {
    return
  }
  if (eventType === 'contact.changed') {
    return Parse.Cloud.run('address-sync-lex', { resourceId }, { useMasterKey: true })
  }
  if (eventType === 'invoice.changed') {
    return Parse.Cloud.run('invoice-sync-lex', { resourceId }, { useMasterKey: true })
  }
  if (eventType === 'invoice.deleted') {
    return Parse.Cloud.run('invoice-delete-lex', { resourceId }, { useMasterKey: true })
  }
  if (eventType === 'credit-note.changed') {
    return Parse.Cloud.run('credit-note-sync-lex', { resourceId }, { useMasterKey: true })
  }
  if (eventType === 'credit-note.deleted') {
    return Parse.Cloud.run('credit-note-delete-lex', { resourceId }, { useMasterKey: true })
  }
  return res.status(200).end()
})

module.exports = router
