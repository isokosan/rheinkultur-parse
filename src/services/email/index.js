const { htmlToText } = require('html-to-text')
const nodemailer = require('nodemailer')
const fs = require('fs').promises
const path = require('path')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 465,
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

const buildMailHtml = ({ template, variables }) => fs
  .readFile(path.join(BASE_DIR, `/services/email/templates/${template}.html`))
  .then(file => eval('`' + file.toString() + '`')) // eslint-disable-line no-eval

const sendMail = async function ({ from, to, cc, bcc, replyTo, subject, html, template, variables, attachments }, skip) {
  if (!html && template) {
    html = await buildMailHtml({ template, variables })
  }
  const text = htmlToText(html, { wordwrap: 130 })
  from = from || process.env.MAIL_FROM
  const devTo = await Parse.Config.get().then(config => config.get('mailToDevelopment'))
  const mail = {
    from,
    replyTo,
    to: devTo || to,
    cc: devTo ? undefined : cc,
    bcc: devTo ? undefined : bcc,
    subject,
    html,
    text,
    attachments
  }
  DEVELOPMENT && consola.info('sending email', mail)
  if (skip) {
    return { skipped: 'skip', sentAt: (new Date()).toISOString(), accepted: [to], rejected: [] }
  }
  const response = await transporter.sendMail(mail)
  DEVELOPMENT && consola.success('Preview message:', nodemailer.getTestMessageUrl(response) || response)
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
