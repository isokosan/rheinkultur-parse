const path = require('path')
const { pubSubAdapter } = require('./redis')
const { replaceLocalIp } = require('./utils')

const port = process.env.PARSE_PORT || 1337
const serverURL = `http://localhost:${port}/parse`
const config = {
  databaseURI: process.env.DATABASE_URI,
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
  maxUploadSize: '500mb',
  sessionLength: 60 * 60 * 24 * 90, // 90 days
  emailAdapter: {
    module: 'parse-smtp-template',
    options: {
      port: 465,
      secure: true,
      host: process.env.SMTP_HOST,
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASS,
      fromAddress: process.env.MAIL_FROM
    }
  },
  enableAnonymousUsers: false,
  accountLockout: {
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
  liveQuery: {
    classNames: [],
    pubSubAdapter
  }
}

module.exports = config
module.exports.port = port
