require('module-alias/register')
require('dotenv').config()
require('./globals')

const { default: ParseServer } = require('parse-server')
const express = require('express')
const app = express()

const config = require('./config')
const { awaitConnection, pubSubAdapter } = require('./redis')
const { port, serverURL } = config

const initApp = async () => {
  await awaitConnection()

  const parseServer = new ParseServer(config)
  app.use('/parse', parseServer.app)
  app.use('/exports', require('./exports'))
  app.use('/webhooks', require('./webhooks'))

  if (process.env.NODE_ENV === 'development') {
    const Dashboard = require('parse-dashboard')
    const apps = [{
      serverURL,
      appId: process.env.APP_ID,
      masterKey: process.env.MASTER_KEY,
      appName: process.env.APP_NAME + ' (dev)'
    }]
    process.env.PRODUCTION_SERVER_URL && apps.push({
      serverURL: process.env.PRODUCTION_SERVER_URL,
      appId: process.env.APP_ID,
      masterKey: process.env.MASTER_KEY,
      appName: process.env.APP_NAME + ' (prod)'
    })
    app.use('/dashboard', new Dashboard({ apps }))
  }

  const httpServer = require('http').createServer(app)
  httpServer.listen(port, function () {
    consola.success(`${process.env.APP_NAME} Parse Server is running on ${serverURL}`)
    ParseServer.createLiveQueryServer(httpServer, { pubSubAdapter })
    consola.success(`${process.env.APP_NAME} Parse LiveQueryServer running on ws://localhost:${port}`)
    process.env.NODE_ENV === 'development' && consola.success(`${process.env.APP_NAME} Parse Dashboard is running on http://localhost:${port}/dashboard`)
  })
}
initApp()
