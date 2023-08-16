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
  maxMessages: 100
})

let signature
const getSignatureHtml = async () => {
  if (!signature) {
    signature = await fs.readFile(path.join(BASE_DIR, '/services/email/signature.html')).then(file => file.toString())
  }
  return signature
}
const buildMailHtml = ({ template, variables }) => fs
  .readFile(path.join(BASE_DIR, `/services/email/templates/${template}.html`))
  .then(async file => eval('`' + file.toString() + '`') + await getSignatureHtml()) // eslint-disable-line no-eval

const sendMail = async function ({ to, cc, bcc, replyTo, subject, html, template, variables, attachments }, skip) {
  if (!html && template) {
    html = await buildMailHtml({ template, variables })
  }
  const text = htmlToText(html, { wordwrap: 130 })
  const devTo = DEVELOPMENT && process.env.MAIL_DEV_TO
  const mail = {
    from: process.env.MAIL_FROM,
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
  if (skip) {
    return { skipped: 'skip', sentAt: (new Date()).toISOString(), accepted: [to], rejected: [] }
  }
  const response = await transporter.sendMail(mail)
  process.env.NODE_ENV === 'development' && consola.success('Preview message:', nodemailer.getTestMessageUrl(response) || response)
  const { accepted, rejected } = response
  if (!accepted.length) {
    throw new Error('E-Mail Adresse nicht akzeptiert.')
  }
  const sentAt = moment().toISOString()
  return { sentAt, accepted, rejected }
}

module.exports = sendMail
module.exports.test = async () => {
  const to = 'denizar@gmail.com'
  const response = await sendMail({
    to,
    subject: 'Test E-Mail',
    template: 'test',
    variables: {
      user: {
        firstName: 'Firstname',
        lastName: 'Lastname'
      },
      message: 'Test message'
    }
  }, DEVELOPMENT)
  return response?.accepted?.includes(to)
}
