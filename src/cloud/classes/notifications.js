const OneSignal = require('onesignal-node')
const client = new OneSignal.Client(process.env.ONESIGNAL_APP_ID, process.env.ONESIGNAL_API_KEY)
const sendMail = require('@/services/email')

const Notification = Parse.Object.extend('Notification')

Parse.Cloud.beforeSave(Notification, ({ object: notification }) => {})

Parse.Cloud.afterSave(Notification, async ({ object: notification, context: { send } }) => {
  if (!send) {
    return
  }
  const user = notification.get('user')
  await user.fetch({ useMasterKey: true })

  // send email
  sendMail({
    to: user.get('email'),
    subject: notification.get('message'),
    template: 'notification',
    variables: {
      user: notification.get('user').toJSON(),
      notification: notification.toJSON()
    }
  })

  // https://documentation.onesignal.com/reference/push-channel-properties
  client.createNotification({
    contents: { en: notification.get('message') },
    include_external_user_ids: [user.id],
    web_url: process.env.WEBAPP_URL + (notification.get('uri') || '') + `?n=${notification.id}`
  })
})

Parse.Cloud.define('notification-read', async ({ params: { id }, user }) => {
  const notification = await $getOrFail(Notification, id)
  if (notification.get('user').id !== user.id) {
    throw new Error('Unauthorized user trying to read notification')
  }
  return notification.set({ readAt: new Date() }).save(null, { useMasterKey: true, context: { send: false } })
}, { requireUser: true })

const notify = async ({ user, message, uri, data }) => {
  const notification = new Notification({ user, message, uri, data })
  return notification.save(null, { useMasterKey: true, context: { send: true } })
}

module.exports = {
  notify
}

global.$notify = notify
