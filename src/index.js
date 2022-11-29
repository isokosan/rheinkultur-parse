require('module-alias/register')
require('dotenv').config()
require('./globals')

const { default: ParseServer } = require('parse-server')
const express = require('express')
const app = express()

const config = require('./config')
const { pubSubAdapter } = require('./redis')
const { port, serverURL } = config
const parseServer = new ParseServer(config)

app.use('/parse', parseServer.app)
app.get('/probe', async (req, res) => {
  const { data } = await Parse.Cloud.httpRequest({
    url: serverURL + '/health',
    headers: {
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-MASTER-key': process.env.MASTER_KEY,
      'Content-Type': 'application/json'
    }
  })
  return res.send(data)
})

if (process.env.NODE_ENV === 'development') {
  const Dashboard = require('parse-dashboard')
  app.use('/dashboard', new Dashboard({
    apps: [
      {
        serverURL,
        appId: process.env.APP_ID,
        masterKey: process.env.MASTER_KEY,
        appName: process.env.APP_NAME
      }
    ]
  }))
}

const httpServer = require('http').createServer(app)
httpServer.listen(port, function () {
  consola.success(`${process.env.APP_NAME} Parse Server is running on ${serverURL}`)
  ParseServer.createLiveQueryServer(httpServer, { pubSubAdapter })
  consola.success(`${process.env.APP_NAME} Parse LiveQueryServer running on ws://localhost:${port}`)
  process.env.NODE_ENV === 'development' && consola.success(`${process.env.APP_NAME} Parse Dashboard is running on http://localhost:${port}/dashboard`)
})
