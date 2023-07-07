const OneSignal = require('onesignal-node')
const client = new OneSignal.Client(process.env.ONESIGNAL_APP_ID, process.env.ONESIGNAL_API_KEY)
const { htmlToText } = require('html-to-text')

const sendPush = async function (userId, message, url) {
  const { body } = await client.createNotification({
    include_external_user_ids: [userId],
    channel_for_external_user_ids: 'push',
    isAnyWeb: true,
    contents: { en: htmlToText(message, { wordwrap: false }) },
    web_url: url
  })
  return body
}

module.exports = sendPush
