const { generateToken, generatePassword, generateDarkColorHex } = require('@/utils')
const { users: { normalizeFields, UNSET_NULL_FIELDS } } = require('@/schema/normalizers')
const sendMail = require('@/services/email')

Parse.Cloud.beforeSave(Parse.User, async ({ object: user, master }) => {
  UNSET_NULL_FIELDS.forEach(field => !user.get(field) && user.unset(field))
  if (user.isNew() && master && user.get('inviteToken')) {
    const mailStatus = await sendMail({
      to: user.get('email'),
      subject: 'Einladung zum ' + process.env.APP_NAME,
      template: 'invitation',
      variables: {
        firstName: user.get('firstName'),
        lastName: user.get('lastName'),
        inviteLink: `${process.env.WEBAPP_URL}/invitation?token=${user.get('inviteToken')}`
      }
    })
    user.set('invitationMailStatus', mailStatus)
  }
  if (!user.get('avatar') && !user.get('color')) {
    user.set('color', generateDarkColorHex())
  }
}, {
  fields: {
    accType: { constant: true },
    inviteToken: { constant: true },
    isBanned: { constant: true, default: false }
  }
})

Parse.Cloud.afterSave(Parse.User, async ({ object: user, context: { audit, clearSessions } }) => {
  $audit(user, audit)
  if (clearSessions) {
    const sessions = await $query(Parse.Session)
      .equalTo('user', user)
      .limit(1000)
      .find({ useMasterKey: true })
    await Promise.all(sessions.map(session => session.destroy({ useMasterKey: true })))
  }
})

Parse.Cloud.afterFind(Parse.User, ({ objects: users }) => {
  for (const user of users) {
    user.set('fullname', user.get('firstName') + ' ' + user.get('lastName'))
  }
  return users
})

Parse.Cloud.define('user-invite', async ({ params: { password, ...params }, user: invitedBy }) => {
  const inviteToken = generateToken()
  const {
    email,
    firstName,
    lastName,
    accType,
    distributorRoles,
    companyId
  } = normalizeFields(params)
  const user = new Parse.User({
    username: email,
    password: password || generatePassword(),
    email,
    firstName,
    lastName,
    accType,
    distributorRoles,
    company: companyId
      ? await $getOrFail('Company', companyId)
      : undefined,
    inviteToken: password ? undefined : inviteToken,
    invitedBy,
    invitedAt: new Date()
  })
  const audit = { user: invitedBy, fn: 'user-invite' }
  return user.signUp(null, { useMasterKey: true, context: { audit } })
}, $adminOrMaster)

Parse.Cloud.define('user-update', async ({ params: { id, ...params }, user: auth }) => {
  const user = await $getOrFail(Parse.User, id, ['companyPerson'])
  const {
    firstName,
    lastName,
    accType,
    pbx,
    mobile,
    companyId,
    companyPersonId
  } = normalizeFields(params)

  const changes = $changes(user, { firstName, lastName, accType, pbx, mobile })
  user.set({ firstName, lastName, accType, pbx, mobile })
  const accTypeChanged = accType !== user.get('accType')
  const companyChanged = companyId !== user.get('company')?.id

  if (companyChanged) {
    changes.companyId = [user.get('company')?.id, companyId]
    const company = companyId ? await $getOrFail('Company', companyId) : null
    company ? user.set({ company }) : user.unset('company')
  }

  if (companyPersonId !== user.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [user.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    companyPerson ? user.set({ companyPerson }) : user.unset('companyPerson')
  }

  const audit = { user: auth, fn: 'user-update', data: { changes } }
  return user.save(null, { useMasterKey: true, context: { audit, clearSessions: (accTypeChanged || companyChanged) } })
}, $adminOrMaster)

Parse.Cloud.define('user-ban', async ({ params: { id: userId }, user: auth }) => {
  const user = await $getOrFail(Parse.User, userId)
  if (user.get('isBanned')) {
    throw new Error('Dieser User wurde schon gebannt.')
  }
  user.set('isBanned', true)
  const audit = { user: auth, fn: 'user-ban' }
  return user.save(null, { useMasterKey: true, context: { audit, clearSessions: true } })
}, $adminOrMaster)

Parse.Cloud.define('user-unban', async ({ params: { id: userId }, user: auth }) => {
  const user = await $getOrFail(Parse.User, userId)
  if (!user.get('isBanned')) {
    throw new Error('Dieser User ist nicht gebannt.')
  }
  user.set('isBanned', false)
  const audit = { user: auth, fn: 'user-unban' }
  return user.save(null, { useMasterKey: true, context: { audit } })
}, $adminOrMaster)

const getUserFromInviteToken = async function (token) {
  if (!token) {
    throw new Error('Einladungslink erforderlich!')
  }
  const user = await $query(Parse.User)
    .equalTo('inviteToken', token)
    .first({ useMasterKey: true })
  if (!user) {
    throw new Error('Dieser Einladungslink ist nicht mehr gültig. Bitte fordern Sie eine neue Einladung an.')
  }
  return user
}

Parse.Cloud.define('validate-invite-token', async ({ params: { token } }) => {
  const user = await getUserFromInviteToken(token)
  return user.get('username')
})

Parse.Cloud.define('accept-invitation', async ({ params: { token, password } }) => {
  const user = await getUserFromInviteToken(token)
  user.set('password', password)
  user.unset('inviteToken')
  return user.save(null, { useMasterKey: true })
})

Parse.Cloud.beforeLogin(({ object: user }) => {
  if (user.get('isBanned')) {
    throw new Error('Zugriff verweigert, Sie wurden gesperrt.')
  }
  user.set({ lastLoginAt: new Date() })
  user.save(null, { useMasterKey: true })
})

const fetchUsers = async function () {
  const items = await $query(Parse.User)
    .limit(1000)
    .find({ useMasterKey: true })
  const response = {}
  for (const item of items) {
    response[item.id] = item.toJSON()
    response[item.id].className = '_User'
  }
  return response
}

module.exports = {
  fetchUsers
}