const sendPush = require('@/services/push')
const sendMail = require('@/services/email')

const { TASK_LIST_STATUSES, BOOKING_REQUEST_TYPES } = require('@/schema/enums')

const Notification = Parse.Object.extend('Notification')

const NOTIFICATIONS = {
  'task-list-assigned': {
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
    message: ({ cubeId, placeKey, rejectionReason }) => `Standort <strong>${cubeId}</strong> in ${placeKey.split(':')[1]} wurde abgelehnt. <strong>${rejectionReason}</strong>`,
    app: 'scout',
    route: ({ placeKey, cubeId }) => ({ name: 'location', params: { placeKey }, query: { cubeId } })
  },
  'active-task-list-updated': {
    message: ({ placeKey, status }) => `Eine Abfahrtsliste in ${TASK_LIST_STATUSES[status]} status in <strong>${placeKey.split(':')[1]}</strong> wurde aktualisiert. Bitte überprüfen Sie den aktuellen Status der Liste.`,
    route: ({ taskListId }) => ({ name: 'task-list', params: { listId: taskListId } }),
    related: notification => $query(Notification)
      .equalTo('user', notification.get('user'))
      .equalTo('data.placeKey', notification.get('data').placeKey)
      .greaterThan('createdAt', moment().subtract(1, 'day').toDate())
      .first({ useMasterKey: true })
  },
  'active-task-list-removed': {
    message: ({ placeKey, status }) => `Eine Abfahrtsliste in ${TASK_LIST_STATUSES[status]} status in <strong>${placeKey.split(':')[1]}</strong> wurde gelöscht.`,
    route: ({ type, orderClass, orderId }) => {
      if (type === 'disassembly') {
        const name = orderClass.toLowerCase()
        return { name: orderClass.toLowerCase(), params: { [`${name}Id`]: orderId }, hash: '#disassembly' }
      }
      return { name: 'fieldwork-list' }
    }
  },
  'booking-request-rejected': {
    mailContent: ({ no, cubeId, type, reason }) => `
      <p>Ihre Buchungsanfrage für die Buchung <strong>${no}</strong> mit dem CityCube <strong>${cubeId}</strong> wurde abgelehnt.</p>
      <p><strong>Art der Anfrage:</strong> ${BOOKING_REQUEST_TYPES[type]}</p>
      <p><strong>Grund für die Ablehnung:</strong></p>
      <p>${reason.replace(/\n/g, '<br>')}</p>
    `,
    message: ({ no, cubeId, type, reason }) => `Ihre Buchungsanfrage für die Buchung <strong>${no}</strong> mit dem CityCube <strong>${cubeId}</strong> wurde abgelehnt.`,
    route: ({ bookingId, requestId, cubeId, no }) => ({ name: 'booking-requests', query: { cubeId, no }, hash: '#booking=' + bookingId + '>' + requestId })
  },
  'booking-request-accept-comments': {
    mailSubject: () => 'Bemerkungen zu Ihrer genehmigten Buchungsanfrage',
    mailContent: ({ no, cubeId, type, comments }) => `
      <p>Ihre Buchungsanfrage für die Buchung <strong>${no}</strong> mit dem CityCube <strong>${cubeId}</strong> wurde genehmight.</p>
      <p><strong>Art der Anfrage:</strong> ${BOOKING_REQUEST_TYPES[type]}</p>
      <p><strong>Bemerkungen zur Buchungsanfrage:</strong></p>
      <p>${comments.replace(/\n/g, '<br>')}</p>
    `,
    message: ({ no, cubeId, type, comments }) => `Bitte lesen Sie die folgenden Bemerkungen zu Ihrer genehmigten Buchungsanfrage für die Buchung <strong>${no}</strong> mit dem CityCube <strong>${cubeId}</strong>.`,
    route: ({ bookingId, requestId, cubeId, no }) => ({ name: 'booking-requests', query: { cubeId, no }, hash: '#booking=' + bookingId + '>' + requestId })
  }
}

const resolveMessage = notification => NOTIFICATIONS[notification.get('identifier')].message(notification.get('data'))
const resolveMailSubject = notification => NOTIFICATIONS[notification.get('identifier')].mailSubject?.(notification.get('data'))
const resolveMailContent = notification => NOTIFICATIONS[notification.get('identifier')].mailContent?.(notification.get('data'))
const resolveApp = notification => NOTIFICATIONS[notification.get('identifier')].app
const resolveRoute = notification => NOTIFICATIONS[notification.get('identifier')].route(notification.get('data'))
const resolveRelated = notification => NOTIFICATIONS[notification.get('identifier')].related?.(notification)

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

const notifyUser = async ({ user, identifier, data }) => {
  const notification = new Notification({ user, identifier, data })
  const related = await resolveRelated(notification)
  if (related) {
    return related.set({ readAt: null }).save(null, { useMasterKey: true })
  }
  return notification.save(null, { useMasterKey: true })
}

const notify = async ({ user, usersQuery, identifier, data }) => {
  if (user && usersQuery) { throw new Error('Cannot notify both user and usersQuery') }
  if (user) { return notifyUser({ user, identifier, data }) }
  return usersQuery.each((record) => {
    return notifyUser({ user: record, identifier, data })
  }, { useMasterKey: true })
}

const send = async (notification) => {
  const user = await notification.get('user').fetch({ useMasterKey: true })
  const url = `${process.env.WEBAPP_URL}/n/${notification.id}`
  const mailContent = resolveMailContent(notification)
  const message = resolveMessage(notification)
  const subject = resolveMailSubject(notification) || message
  notification.set('push', await sendPush(user.id, message, url))
  mailContent && notification.set('mail', await sendMail({
    to: user.get('email'),
    bcc: null,
    subject,
    template: 'notification',
    variables: {
      user: notification.get('user').toJSON(),
      mailContent,
      url
    }
  }))
  return notification.set('sentAt', new Date()).save(null, { useMasterKey: true })
}

module.exports = {
  notify
}

global.$notify = notify
