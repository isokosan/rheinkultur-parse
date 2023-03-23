const OneSignal = require('onesignal-node')
const client = new OneSignal.Client(process.env.ONESIGNAL_APP_ID, process.env.ONESIGNAL_API_KEY)
const sendMail = require('@/services/email')

const Notification = Parse.Object.extend('Notification')

const NOTIFICATIONS = {
  'task-list-assigned': {
    message: ({ placeKey }) => `You have been assigned to scout ${placeKey.split(':')[1]}.`,
    route: ({ placeKey }) => ({ name: 'location', params: { placeKey } }),
    skip: notification => $query(Notification)
      .equalTo('user', notification.get('user'))
      .equalTo('data.placeKey', notification.get('data').placeKey)
      .greaterThan('createdAt', moment().subtract(1, 'day').toDate())
      .exists({ useMasterKey: true })
  },
  'task-submission-rejected': {
    message: ({ cubeId, rejectionReason }) => `Your submission for ${cubeId} was rejected. ${rejectionReason}`,
    route: ({ placeKey, cubeId }) => ({ name: 'location', params: { placeKey }, query: { cubeId } })
  }
}

const resolveMessage = (notification) => NOTIFICATIONS[notification.get('identifier')].message(notification.get('data'))
const resolveRoute = (notification) => NOTIFICATIONS[notification.get('identifier')].route(notification.get('data'))
const shouldSkip = (notification) => NOTIFICATIONS[notification.get('identifier')].skip?.(notification)

Parse.Cloud.beforeSave(Notification, ({ object: notification }) => {
  if (!NOTIFICATIONS[notification.get('identifier')]) { throw new Error('Unrecognized notification identifier') }
})

Parse.Cloud.afterFind(Notification, async ({ objects: notifications }) => {
  for (const notification of notifications) {
    notification.set('message', resolveMessage(notification))
    notification.set('web_url', `${process.env.WEBAPP_URL}/n/${notification.id}`)
  }
})

Parse.Cloud.afterSave(Notification, async ({ object: notification, context: { send } }) => {
  if (!send) { return }
  if (await shouldSkip(notification)) { return }

  const user = notification.get('user')
  await user.fetch({ useMasterKey: true })

  const message = notification.get('message')
  const web_url = notification.get('web_url')

  // send email
  sendMail({
    to: user.get('email'),
    subject: message,
    template: 'notification',
    variables: {
      user: notification.get('user').toJSON(),
      message,
      web_url
    }
  })
  // https://documentation.onesignal.com/reference/push-channel-properties
  client.createNotification({
    contents: { en: message },
    include_external_user_ids: [user.id],
    web_url
  })
})

Parse.Cloud.define('notification-see', async ({ params: { ids }, user }) => {
  const notifications = await $query(Notification).containedIn('objectId', ids).equalTo('seenAt', null).find({ sessionToken: user.getSessionToken() })
  return Parse.Object.saveAll(notifications.map(notification => notification.set('seenAt', new Date())), { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('notification-read', async ({ params: { id }, user }) => {
  const notification = await $query(Notification).get(id, { sessionToken: user.getSessionToken() })
  !notification.get('readAt') && await notification.set('readAt', new Date()).save(null, { useMasterKey: true })
  return resolveRoute(notification)
}, { requireUser: true })

const notify = async ({ user, identifier, data }) => {
  const notification = new Notification({ user, identifier, data })
  return notification.save(null, { useMasterKey: true, context: { send: true } })
}

module.exports = {
  notify
}

global.$notify = notify
