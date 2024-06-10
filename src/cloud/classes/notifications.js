const { isEqual, kebabCase } = require('lodash')
const sendPush = require('@/services/push')
const sendMail = require('@/services/email')

const { TASK_LIST_STATUSES, BOOKING_REQUEST_TYPES } = require('@/schema/enums')
const Notification = Parse.Object.extend('Notification')

const number = value => typeof value === 'number' ? new Intl.NumberFormat('de-DE').format(value) : '-'
const pluralize = (value, singular, plural, zero) => {
  if (typeof value !== 'number') {
    value = value?.length || 0
  }
  if (value === 1) {
    return number(value) + ' ' + singular
  }
  if (value === 0 && zero) {
    return number(value) + ' ' + zero
  }
  return number(value) + ' ' + plural
}

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
        const name = kebabCase(orderClass)
        return { name: kebabCase(orderClass), params: { [`${name}Id`]: orderId }, hash: '#disassembly' }
      }
      return { name: 'fieldwork-list' }
    }
  },
  'task-list-marked-incomplete': {
    message: ({ placeKey, comments }) => `Eine Abfahrtsliste in <strong>${placeKey.split(':')[1]}</strong> wurde als unvollständig erledigt markiert. Kommentar: ${comments}`,
    route: ({ taskListId }) => ({ name: 'task-list', params: { listId: taskListId } })
  },
  'disassembly-canceled': {
    message: ({ placeKey, status }) => {
      return `Eine geplante Demontage in ${TASK_LIST_STATUSES[status]} status in <strong>${placeKey.split(':')[1]}</strong> konnte nicht abgesagt werden. Bitte stornieren Sie sie und synchronisieren Sie die Demontagen erneut.`
    },
    route: ({ taskListId }) => ({ name: 'task-list', params: { listId: taskListId } })
  },
  'booking-request-rejected': {
    mailContent: ({ no, cubeId, type, reason }) => `
      <p>Ihre Buchungsanfrage für die Buchung <strong>${no}</strong> mit dem CityCube <strong>${cubeId}</strong> wurde abgelehnt.</p>
      <p><strong>Art der Anfrage:</strong> ${BOOKING_REQUEST_TYPES[type]}</p>
      <p><strong>Grund für die Ablehnung:</strong></p>
      <p>${reason?.replace(/\n/g, '<br>')}</p>
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
      <p>${comments?.replace(/\n/g, '<br>')}</p>
    `,
    message: ({ no, cubeId, type }) => `Bitte lesen Sie die folgenden Bemerkungen zu Ihrer genehmigten Buchungsanfrage für die Buchung <strong>${no}</strong> mit dem CityCube <strong>${cubeId}</strong>.`,
    route: ({ bookingId, requestId, cubeId, no }) => ({ name: 'booking-requests', query: { cubeId, no }, hash: '#booking=' + bookingId + '>' + requestId })
  },
  'frame-mount-request-rejected': {
    mailContent: ({ pk, reason }) => `
      <p>Ihre Anfrage für die Moskitorahmen in <strong>${pk.split(':')[1]}</strong> wurde abgelehnt.</p>
      <p><strong>Grund für die Ablehnung:</strong></p>
      <p>${reason?.replace(/\n/g, '<br>')}</p>
    `,
    message: ({ pk, reason }) => `Ihre Anfrage für die Moskitorahmen in <strong>${pk.split(':')[1]}</strong> wurde abgelehnt.`,
    route: ({ frameMountId, requestId }) => ({ name: 'frame-mount', params: { id: frameMountId }, hash: '#request' + requestId })
  },
  'frame-mount-request-accept-comments': {
    mailSubject: () => 'Bemerkungen zu Ihrer genehmigten Anfrage',
    mailContent: ({ pk, rejectionCount, comments }) => `
      <p>Ihre Anfrage für die Moskitorahmen in <strong>${pk.split(':')[1]}</strong> wurde genehmight.</p>
      ${rejectionCount ? `<p><strong>${rejectionCount} Standort${rejectionCount === 1 ? ' wurde' : 'e wurden'} abgelehnt.</strong></p>` : ''}
      <p><strong>Bemerkungen zur Anfrage:</strong></p>
      <p>${comments?.replace(/\n/g, '<br>')}</p>
    `,
    message: ({ pk }) => `Bitte lesen Sie die folgenden Bemerkungen zu Ihrer genehmigten Anfrage für die Moskitorahmen in <strong>${pk.split(':')[1]}</strong>.`,
    route: ({ frameMountId, requestId }) => ({ name: 'frame-mount', params: { id: frameMountId }, hash: '#request' + requestId })
  },
  'frame-mount-takedown-request': {
    mailSubject: () => 'Neue Moskitorahmen Demontageauftrag',
    mailContent: ({ pk, cubeIds }) => `
      <p>Neue Demontageauftrag in <strong>${pk.split(':')[1]}</strong> für ${pluralize(cubeIds.length, 'CityCube', 'CityCubes')}.</p>
      <p>Bitte überprüfen Sie den Auftrag und führen Sie die Demontage durch, dann markieren Sie ihn als "Erledigt".</p>
    `,
    message: ({ pk, cubeIds }) => `Neuer Demontageauftrag in ${pk.split(':')[1]} für ${pluralize(cubeIds.length, 'CityCube', 'CityCubes')}. Bitte überprüfen Sie den Auftrag und führen Sie die Demontage durch, dann markieren Sie ihn als 'Erledigt'.`,
    route: ({ frameMountId }) => ({ name: 'frame-mount', params: { id: frameMountId }, hash: '#filter-tdPending' })
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
    if (isEqual(related.get('data'), notification.get('data'))) {
      // no changes
      return
    }
    // set read at to null if the data has changed
    return related.set({ readAt: null, data }).save(null, { useMasterKey: true })
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

sendMail({
  to: 'denizar@gmail.com',
  subject: 'Testing',
  html: '<p>testing</p>'
}).then(console.log)
