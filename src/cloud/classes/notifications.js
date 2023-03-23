const sendPush = require('@/services/push')
const sendMail = require('@/services/email')

const Notification = Parse.Object.extend('Notification')

const NOTIFICATIONS = {
  'task-list-assigned': {
    message: ({ placeKey }) => `You have been assigned to scout ${placeKey.split(':')[1]}.`,
    route: ({ placeKey }) => ({ name: 'location', params: { placeKey } }),
    related: notification => $query(Notification)
      .equalTo('user', notification.get('user'))
      .equalTo('data.placeKey', notification.get('data').placeKey)
      .greaterThan('createdAt', moment().subtract(1, 'day').toDate())
      .first({ useMasterKey: true })
  },
  'task-submission-rejected': {
    message: ({ cubeId, rejectionReason }) => `Your submission for ${cubeId} was rejected. ${rejectionReason}`,
    route: ({ placeKey, cubeId }) => ({ name: 'location', params: { placeKey }, query: { cubeId } })
  }
}

const resolveMessage = (notification) => NOTIFICATIONS[notification.get('identifier')].message(notification.get('data'))
const resolveRoute = (notification) => NOTIFICATIONS[notification.get('identifier')].route(notification.get('data'))
const resolveRelated = (notification) => NOTIFICATIONS[notification.get('identifier')].related?.(notification)

Parse.Cloud.beforeSave(Notification, ({ object: notification }) => {
  if (!NOTIFICATIONS[notification.get('identifier')]) { throw new Error('Unrecognized notification identifier') }
})

Parse.Cloud.afterSave(Notification, ({ object: notification }) => {
  notification.get('sentAt') || send(notification)
})

Parse.Cloud.afterFind(Notification, async ({ objects: notifications, user }) => {
  const see = user && notifications
    .filter(notification => !notification.get('seenAt') && notification.get('user').id === user.id)
    .map(notification => notification.set('seenAt', new Date()))
  see?.length && await Parse.Object.saveAll(see, { useMasterKey: true })
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
  const related = await resolveRelated(notification)
  if (related) {
    return related.set({ readAt: null, seenAt: null }).save(null, { useMasterKey: true })
  }
  return notification.save(null, { useMasterKey: true })
}

const send = async (notification) => {
  const user = await notification.get('user').fetch({ useMasterKey: true })
  const message = resolveMessage(notification)
  const url = `${process.env.WEBAPP_URL}/n/${notification.id}`

  notification.set('push', await sendPush(user.id, message, url))
  notification.set('mail', await sendMail({
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
