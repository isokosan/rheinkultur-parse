const OneSignal = require('onesignal-node')
const client = new OneSignal.Client(process.env.ONESIGNAL_APP_ID, process.env.ONESIGNAL_API_KEY)

const sendPush = async function (userId, message, url) {
  const { body } = await client.createNotification({
    include_external_user_ids: [userId],
    contents: { en: message },
    web_url: url
  })
  return body
}

module.exports = sendPush
