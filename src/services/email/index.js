const { htmlToText } = require('html-to-text')
const nodemailer = require('nodemailer')
const fs = require('fs').promises
const path = require('path')

if (DEVELOPMENT && !process.env.MAIL_DEV_TO) {
  throw new Error('Please set a development to email address for emails')
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  //  – set to true to use pooled connections (defaults to false) instead of creating a new connection for every email
  pool: true,
  //  – is the count of maximum simultaneous connections to make against the SMTP server (defaults to 5)
  maxConnections: 5,
  //  – limits the message count to be sent using a single connection (defaults to 100). After maxMessages is reached the connection is dropped and a new one is created for the following messages
  maxMessages: 100,
  dkim: {
    domainName: 'rheinkultur-medien.de',
    keySelector: 'default',
    privateKey: process.env.SMTP_DKIM_KEY
  },
  cacheDir: path.join(BASE_DIR, '/services/email/cache'),
  debug: true
})

let wrapper
const getWrapperHtml = async () => {
  if (!wrapper) {
    wrapper = await fs.readFile(path.join(BASE_DIR, '/services/email/wrapper.html')).then(file => file.toString())
  }
  return wrapper
}
const buildMailHtml = ({ template, variables }) => fs
  .readFile(path.join(BASE_DIR, `/services/email/templates/${template}.html`))
  .then(file => file.toString())
  .then(content => eval('`' + content + '`')) // eslint-disable-line no-eval
  .then(body => getWrapperHtml().then(wrapper => eval('`' + wrapper + '`'))) // eslint-disable-line no-eval

const sendMail = async function ({ to, cc, bcc, replyTo, subject, html, template, variables, attachments }, testing) {
  if (!html && template) {
    html = await buildMailHtml({ template, variables })
  }
  const text = htmlToText(html, { wordwrap: 130 })
  const devTo = DEVELOPMENT && process.env.MAIL_DEV_TO
  const mail = {
    from: '"Rheinkultur Medien & Verlags GmbH" <rechnung@rheinkultur-medien.de>',
    to: devTo || to,
    cc: cc !== undefined ? cc : (devTo ? null : process.env.MAIL_CC),
    bcc: bcc !== undefined ? bcc : (devTo ? null : process.env.MAIL_BCC),
    replyTo: replyTo !== undefined ? replyTo : process.env.MAIL_REPLY_TO,
    subject: htmlToText(subject, { wordwrap: false }),
    html,
    text,
    attachments
  }
  process.env.NODE_ENV === 'development' && consola.info('sending email', mail)
  const response = await transporter.sendMail(mail)
  process.env.NODE_ENV === 'development' && consola.success('Preview message:', nodemailer.getTestMessageUrl(response) || response)
  if (testing) {
    return { mail, response }
  }
  const { accepted, rejected } = response
  if (!accepted.length) {
    throw new Error('E-Mail Adresse nicht akzeptiert.')
  }
  const sentAt = moment().toISOString()
  return { sentAt, accepted, rejected }
}

const test = async () => {
  return sendMail({
    to: 'denizar@gmail.com',
    subject: 'Test Mail',
    template: 'test',
    variables: {
      user: {
        firstName: 'Firstname',
        lastName: 'Lastname'
      },
      message: 'Test message'
    }
  }, true)
}

module.exports = sendMail
module.exports.test = test
