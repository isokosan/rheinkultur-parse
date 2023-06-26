const sendPush = require('@/services/push')
const sendMail = require('@/services/email')

const Notification = Parse.Object.extend('Notification')

const NOTIFICATIONS = {
  'task-list-assigned': {
    mail: false,
    message: ({ placeKey }) => `Du hast eine neue Aufgabe in <strong>${placeKey.split(':')[1]}</strong> zugeteilt bekommen.`,
    app: 'scout',
    route: ({ placeKey }) => ({ name: 'location', params: { placeKey } }),
    related: notification => $query(Notification)
      .equalTo('user', notification.get('user'))
      .equalTo('data.placeKey', notification.get('data').placeKey)
      .greaterThan('createdAt', moment().subtract(1, 'day').toDate())
      .first({ useMasterKey: true })
  },
  'task-submission-rejected': {
    mail: false,
    // TOTRANSLATE
    message: ({ cubeId, rejectionReason }) => `Your submission for ${cubeId} was rejected. ${rejectionReason}`,
    app: 'scout',
    route: ({ placeKey, cubeId }) => ({ name: 'location', params: { placeKey }, query: { cubeId } })
  },
  'booking-request-rejected': {
    mail: false,
    message: ({ no, cubeId, type, reason }) => `Your ${type} submission for booking ${no} for ${cubeId} was rejected. ${reason}`,
    route: ({ bookingId, requestId, cubeId, no }) => ({ name: 'booking-requests', query: { cubeId, no }, hash: '#booking=' + bookingId + '>' + requestId })
  }
}

const resolveMessage = (notification) => NOTIFICATIONS[notification.get('identifier')].message(notification.get('data'))
const resolveApp = (notification) => NOTIFICATIONS[notification.get('identifier')].app
const resolveRoute = (notification) => NOTIFICATIONS[notification.get('identifier')].route(notification.get('data'))
const resolveRelated = (notification) => NOTIFICATIONS[notification.get('identifier')].related?.(notification)
const resolveShouldSendPush = (notification, user) => {
  const { push } = NOTIFICATIONS[notification.get('identifier')]
  return push !== false // && user.get('settings').notifications.push
}
const resolveShouldSendMail = (notification, user) => {
  const { mail } = NOTIFICATIONS[notification.get('identifier')]
  return mail !== false // && user.get('settings').notifications.email
}

Parse.Cloud.beforeSave(Notification, ({ object: notification }) => {
  if (!NOTIFICATIONS[notification.get('identifier')]) { throw new Error('Unrecognized notification identifier') }
})

Parse.Cloud.afterSave(Notification, ({ object: notification }) => {
  notification.get('sentAt') || send(notification)
})

Parse.Cloud.beforeFind(Notification, async ({ query, user, master }) => {
  user && !master && query.equalTo('user', user)
})

Parse.Cloud.beforeSubscribe(Notification, async ({ query, user, master }) => {
  user && !master && query.equalTo('user', user)
})

Parse.Cloud.afterFind(Notification, async ({ objects: notifications, user }) => {
  for (const notification of notifications) {
    notification.set('message', resolveMessage(notification))
    notification.set('url', `${process.env.WEBAPP_URL}/n/${notification.id}`)
  }
})

Parse.Cloud.afterLiveQueryEvent(Notification, async ({ object: notification, event }) => {
  if (event === 'create' || event === 'update') {
    notification.set('message', resolveMessage(notification))
    notification.set('url', `${process.env.WEBAPP_URL}/n/${notification.id}`)
  }
})

Parse.Cloud.define('notification-read', async ({ params: { id }, user }) => {
  const notification = await $query(Notification).get(id, { sessionToken: user.getSessionToken() })
  !notification.get('readAt') && await notification.set('readAt', new Date()).save(null, { useMasterKey: true })
  return {
    app: resolveApp(notification),
    route: resolveRoute(notification)
  }
}, { requireUser: true })

const notify = async ({ user, identifier, data }) => {
  const notification = new Notification({ user, identifier, data })
  const related = await resolveRelated(notification)
  if (related) {
    return related.set({ readAt: null }).save(null, { useMasterKey: true })
  }
  return notification.save(null, { useMasterKey: true })
}

const send = async (notification) => {
  const user = await notification.get('user').fetch({ useMasterKey: true })
  const message = resolveMessage(notification)
  const url = `${process.env.WEBAPP_URL}/n/${notification.id}`

  resolveShouldSendPush(notification, user) && notification.set('push', await sendPush(user.id, message, url))
  resolveShouldSendMail(notification, user) && notification.set('mail', await sendMail({
    to: user.get('email'),
    subject: message,
    template: 'notification',
    variables: {
      user: notification.get('user').toJSON(),
      message,
      url
    }
  }))
  return notification.set('sentAt', new Date()).save(null, { useMasterKey: true })
}

module.exports = {
  notify
}

global.$notify = notify
