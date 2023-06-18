require('module-alias/register')
require('dotenv').config()
require('./globals')

const path = require('path')
const express = require('express')
const { default: ParseServer } = require('parse-server')
const S3Adapter = require('@parse/s3-files-adapter')
const { awaitConnection, pubSubAdapter } = require('@/services/redis')
const expressLogger = require('./logger')
const { adapter: loggerAdapter } = require('@/services/winston')

function replaceLocalIp (url) {
  if (!url.includes('0.0.0.0')) {
    return url
  }
  const localIp =
    Object.values(require('os').networkInterfaces())
      .flat()
      .find((network) => network?.address.startsWith('192.168.'))?.address || '0.0.0.0'
  return url.replace('0.0.0.0', localIp)
}

const initApp = async () => {
  await awaitConnection()
  const port = process.env.PARSE_PORT || 1337
  const serverURL = `http://localhost:${port}/parse`
  const parseServer = new ParseServer({
    databaseURI: process.env.DATABASE_URI,
    databaseOptions: !DEVELOPMENT ? { enableSchemaHooks: true } : undefined,
    // cacheAdapter: parseCacheAdapter,
    appId: process.env.APP_ID,
    appName: process.env.APP_NAME,
    masterKey: process.env.MASTER_KEY,
    readOnlyMasterKey: process.env.READ_ONLY_MASTER_KEY,
    clientKey: process.env.CLIENT_KEY,
    javascriptKey: process.env.JAVASCRIPT_KEY,
    restAPIKey: process.env.REST_API_KEY,
    serverURL,
    publicServerURL: replaceLocalIp(process.env.PUBLIC_SERVER_URL),
    allowClientClassCreation: false,
    allowCustomObjectId: true,
    cloud: path.join(__dirname, '/cloud/main.js'),
    maxUploadSize: '100mb',
    sessionLength: 60 * 60 * 24 * 90, // 90 days
    loggerAdapter,
    emailAdapter: {
      module: 'parse-smtp-template',
      options: {
        port: 465,
        secure: true,
        host: process.env.SMTP_HOST,
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASS,
        fromAddress: process.env.MAIL_FROM,
        multiTemplate: true,
        passwordTemplatePath: '/src/services/email/templates/password-template.html',
        passwordOptions: {
          subject: 'Passwort zurücksetzen',
          body: 'Bitte klicken Sie auf den Link unten, um Ihr Passwort zurückzusetzen.',
          btn: 'Passwort zurücksetzen'
        }
      }
    },
    customPages: {
      choosePassword: `${process.env.WEBAPP_URL}/choose-password`,
      invalidLink: `${process.env.WEBAPP_URL}/invalid-link`,
      passwordResetSuccess: `${process.env.WEBAPP_URL}/password-reset-success`
    },
    enableAnonymousUsers: false,
    accountLockout: DEVELOPMENT
      ? undefined
      : {
        duration: 5, // duration policy setting determines the number of minutes that a locked-out account remains locked out before automatically becoming unlocked. Set it to a value greater than 0 and less than 100000.
        threshold: 3, // threshold policy setting determines the number of failed sign-in attempts that will cause a user account to be locked. Set it to an integer value greater than 0 and less than 1000.
        unlockOnPasswordReset: true
      },
    passwordPolicy: {
      doNotAllowUsername: true, // optional setting to disallow username in passwords,
      resetTokenValidityDuration: 24 * 60 * 60 // expire after 24 hours
    },
    enforcePrivateUsers: true,
    directAccess: false,
    // logs
    logLevel: 'error',
    maxLogFiles: '7d',
    verbose: false,
    schema: require('./schema'),
    liveQuery: {
      classNames: ['Audit', 'Comment', 'TaskList', 'Notification'],
      pubSubAdapter
    },
    filesAdapter: process.env.AWS_S3_BUCKET
      ? new S3Adapter({
        bucket: process.env.AWS_S3_BUCKET,
        region: process.env.AWS_S3_REGION
      })
      : undefined
  })

  const app = express()
  app.disable('x-powered-by')
  app.use(expressLogger)
  app.use('/parse', parseServer.app)
  app.use('/exports', require('./exports'))
  app.use('/webhooks', require('./webhooks'))
  app.use('/test-services', require('./services/tests'))

  if (DEVELOPMENT) {
    const Dashboard = require('parse-dashboard')
    const apps = [
      {
        serverURL,
        appId: process.env.APP_ID,
        masterKey: process.env.MASTER_KEY,
        appName: process.env.APP_NAME + ' (dev)'
      }
    ]
    process.env.PRODUCTION_SERVER_URL &&
      apps.push({
        serverURL: process.env.PRODUCTION_SERVER_URL,
        appId: process.env.APP_ID,
        masterKey: process.env.MASTER_KEY,
        appName: process.env.APP_NAME + ' (prod)'
      })
    app.use('/dashboard', new Dashboard({ apps }, { dev: true }))
  }

  const httpServer = require('http').createServer(app)
  httpServer.listen(port, function () {
    consola.success(`${process.env.APP_NAME} Parse Server is running on ${serverURL}`)
    ParseServer.createLiveQueryServer(httpServer, { pubSubAdapter })
    consola.success(`${process.env.APP_NAME} Parse LiveQueryServer running on ws://localhost:${port}`)
    DEVELOPMENT ? consola.warn('Running in DEVELOPMENT mode') : consola.success('Running in PRODUCTION mode')
    DEVELOPMENT &&
      consola.success(`${process.env.APP_NAME} Parse Dashboard is running on http://localhost:${port}/dashboard`)
  })
}
initApp()
