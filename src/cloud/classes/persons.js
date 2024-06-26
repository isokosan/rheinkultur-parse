const { persons: { normalizeFields, UNSET_NULL_FIELDS } } = require('@/schema/normalizers')
const { ORDER_CLASSES } = require('@/shared')
const Person = Parse.Object.extend('Person')

Parse.Cloud.beforeSave(Person, ({ object: person }) => {
  UNSET_NULL_FIELDS.forEach(field => !person.get(field) && person.unset(field))
})

Parse.Cloud.afterSave(Person, async ({ object: person, context: { audit } }) => { $audit(person.get('company'), audit) })

Parse.Cloud.beforeDelete(Person, async ({ object: person }) => {
  await Promise.all([
    ...ORDER_CLASSES.map(orderClass => $query(orderClass).equalTo('companyPerson', person)),
    $query('Contract').equalTo('agencyPerson', person),
    $query('Offer').equalTo('companyPerson', person),
    $query('Invoice').equalTo('companyPerson', person),
    $query('CreditNote').equalTo('companyPerson', person)
  ].map(async query => {
    const count = await query.count({ useMasterKey: true })
    if (count) {
      throw new Error('Die Ansprechpartner:in ist mit einem Auftrag, Angebot, Rechnung oder Gutschrift verbunden und kann nicht gelöscht werden.')
    }
  }))
})

Parse.Cloud.afterDelete(Person, async ({ object: person, context: { audit } }) => { $audit(person.get('company'), audit) })

Parse.Cloud.afterFind(Person, ({ objects: persons }) => {
  for (const person of persons) {
    person.set('fullName', person.get('firstName') + ' ' + person.get('lastName'))
  }
})

Parse.Cloud.define('person-save', async ({ params: { id: personId, ...params }, user }) => {
  const {
    companyId,
    prefix,
    firstName,
    lastName,
    title,
    pbx,
    mobile,
    email
  } = normalizeFields(params)

  if (!personId) {
    const person = new Person({
      company: companyId ? await $getOrFail('Company', companyId) : null,
      prefix,
      firstName,
      lastName,
      title,
      pbx,
      mobile,
      email
    })
    const audit = { user, fn: 'person-create', data: { prefix, firstName, lastName } }
    return person.save(null, { useMasterKey: true, context: { audit } })
  }
  const person = await $getOrFail(Person, personId)
  const changes = $changes(person, { prefix, firstName, lastName, title, email, pbx, mobile })
  person.set({
    prefix,
    firstName,
    lastName,
    title,
    email,
    pbx,
    mobile
  })
  const audit = { user, fn: 'person-update', data: { prefix, firstName, lastName, changes } }
  return person.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('person-delete', async ({ params: { id: personId }, user }) => {
  const person = await $getOrFail(Person, personId)
  const { prefix, firstName, lastName } = person.toJSON()
  const audit = { user, fn: 'person-delete', data: { prefix, firstName, lastName } }
  return person.destroy({ useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('person-titles', () => $query('Person').distinct('title', { useMasterKey: true }), { requireUser: true })
