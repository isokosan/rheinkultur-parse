const Briefing = Parse.Object.extend('Briefing')
const DepartureList = Parse.Object.extend('DepartureList')

Parse.Cloud.afterSave(Briefing, ({ object: briefing, context: { audit } }) => { $audit(briefing, audit) })

Parse.Cloud.beforeFind(Briefing, ({ query }) => {
  query._include.includes('all') && query.include(['company', 'companyPerson', 'departureLists', 'docs'])
})

Parse.Cloud.afterFind(Briefing, async ({ query, objects: briefings }) => {
  if (query._include.includes('departureLists')) {
    const departureLists = await $query(DepartureList).containedIn('briefing', briefings).limit(1000).find({ useMasterKey: true })
    for (const briefing of briefings) {
      briefing.set('departureLists', departureLists.filter(s => s.get('briefing').id === briefing.id))
    }
  }
  if (query._include.includes('departureListCount')) {
    for (const briefing of briefings) {
      briefing.set('departureListCount', await $query(DepartureList).equalTo('briefing', briefing).count({ useMasterKey: true }))
    }
  }
})

Parse.Cloud.afterDelete(Briefing, $deleteAudits)

Parse.Cloud.define('briefing-create', async ({
  params: {
    name,
    companyId,
    companyPersonId
  }, user
}) => {
  const briefing = new Briefing({
    name,
    company: companyId ? await $getOrFail('Company', companyId) : undefined,
    companyPerson: companyPersonId ? await $getOrFail('Person', companyPersonId) : undefined
  })

  const audit = { user, fn: 'briefing-create' }
  return briefing.save(null, { useMasterKey: true, context: { audit } })
}, {
  requireUser: true,
  fields: {
    name: {
      type: String,
      required: true
    }
  }
})

Parse.Cloud.define('briefing-update', async ({
  params: {
    id: briefingId,
    name,
    companyId,
    companyPersonId
  }, user
}) => {
  const briefing = await $getOrFail(Briefing, briefingId, ['companyPerson'])
  const changes = $changes(briefing, { name })
  briefing.set({ name })
  if (companyId !== briefing.get('company')?.id) {
    changes.companyId = [briefing.get('company')?.id, companyId]
    const company = companyId ? await $getOrFail('Company', companyId) : null
    company ? briefing.set('company', company) : briefing.unset('company')
  }
  if (companyPersonId !== briefing.get('company')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [briefing.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    companyPerson ? briefing.set('companyPerson', companyPerson) : briefing.unset('companyPerson')
  }

  const audit = { user, fn: 'briefing-update', data: { changes } }
  return briefing.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('briefing-add-lists', async ({ params: { id: briefingId, lists }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  for (const placeKey of Object.keys(lists || {})) {
    let departureList = await $query('DepartureList')
      .equalTo('briefing', briefing)
      .equalTo('placeKey', placeKey)
      .first({ useMasterKey: true })
    if (!departureList) {
      const [ort, stateId] = placeKey.split('_')
      const state = await $getOrFail('State', stateId)
      departureList = new DepartureList({
        name: `${briefing.get('name')} ${ort} (${state.get('name')})`,
        type: 'scout',
        briefing,
        ort,
        state,
        cubeIds: lists[placeKey]
      })
      const audit = { user, fn: 'departure-list-generate' }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
      continue
    }
    const cubeIds = [...new Set([...(departureList.get('cubeIds') || []), ...lists[placeKey]])]
    const cubeChanges = $cubeChanges(departureList, cubeIds)
    if (cubeChanges) {
      departureList.set({ cubeIds })
      const audit = { user, fn: 'departure-list-update', data: { cubeChanges } }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  return true
}, { requireUser: true })

Parse.Cloud.define('briefing-remove', async ({ params: { id: briefingId }, user, context: { seedAsId } }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  if (briefing.get('status')) {
    throw new Error('Only draft briefings can be deleted!')
  }
  while (true) {
    const departureLists = await $query('DepartureList')
      .equalTo('briefing', briefing)
      .find({ useMasterKey: true })
    if (!departureLists.length) {
      break
    }
    await Promise.all(departureLists.map((sl) => {
      return sl.get('status')
        ? sl.unset('briefing').save(null, { useMasterKey: true })
        : sl.destroy({ useMasterKey: true })
    }))
  }
  return briefing.destroy({ useMasterKey: true })
}, { requireUser: true })
