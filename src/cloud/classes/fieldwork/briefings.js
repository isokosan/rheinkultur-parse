const Briefing = Parse.Object.extend('Briefing')
const DepartureList = Parse.Object.extend('DepartureList')

// Parse.Cloud.beforeSave(Briefing, async ({ object: briefing }) => {
//   briefing.isNew() && !briefing.get('no') && briefing.set({ no: await getNewNo('S' + moment(await $today()).format('YY') + '-', Briefing, 'no') })
// })

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
    const pipeline = [
      { $match: { _p_briefing: { $in: briefings.map(b => 'Briefing$' + b.id) } } },
      { $group: { _id: '$briefing', departureListCount: { $sum: 1 }, cubeCount: { $sum: '$cubeCount' } } }
    ]
    const counts = await $query(DepartureList).aggregate(pipeline)
      .then(response => response.reduce((acc, { objectId, departureListCount, cubeCount }) => ({ ...acc, [objectId]: { departureListCount, cubeCount } }), {}))
    for (const briefing of briefings) {
      briefing.set(counts[briefing.id])
    }
  }
})

Parse.Cloud.afterDelete(Briefing, $deleteAudits)

Parse.Cloud.define('briefing-create', async ({
  params: {
    name,
    companyId,
    // companyPersonId,
    date,
    dueDate
  }, user
}) => {
  const briefing = new Briefing({
    name,
    company: companyId ? await $getOrFail('Company', companyId) : undefined,
    // companyPerson: companyPersonId ? await $getOrFail('Person', companyPersonId) : undefined,
    date,
    dueDate
  })

  const audit = { user, fn: 'briefing-create' }
  return briefing.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('briefing-update', async ({
  params: {
    id: briefingId,
    name,
    companyId,
    // companyPersonId,
    date,
    dueDate
  }, user
}) => {
  const briefing = await $getOrFail(Briefing, briefingId, ['companyPerson'])
  const changes = $changes(briefing, { name, date, dueDate })
  briefing.set({ name, date, dueDate })
  if (companyId !== briefing.get('company')?.id) {
    changes.companyId = [briefing.get('company')?.id, companyId]
    const company = companyId ? await $getOrFail('Company', companyId) : null
    company ? briefing.set('company', company) : briefing.unset('company')
  }
  // if (companyPersonId !== briefing.get('company')?.id) {
  //   const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
  //   changes.companyPerson = [briefing.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
  //   companyPerson ? briefing.set('companyPerson', companyPerson) : briefing.unset('companyPerson')
  // }
  const audit = { user, fn: 'briefing-update', data: { changes } }
  return briefing.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('briefing-add-lists', async ({ params: { id: briefingId, lists }, user }) => {
  const briefing = await $getOrFail(Briefing, briefingId)
  const date = briefing.get('date')
  const dueDate = briefing.get('dueDate')
  if (!date || !dueDate) {
    throw new Error('Briefing has no date or due date!')
  }
  for (const placeKey of Object.keys(lists || {})) {
    const [stateId, ort] = placeKey.split(':')
    const state = $pointer('State', stateId)
    let departureList = await $query('DepartureList')
      .equalTo('briefing', briefing)
      .equalTo('ort', ort)
      .equalTo('state', state)
      .first({ useMasterKey: true })
    if (!departureList) {
      departureList = new DepartureList({
        type: 'scout',
        briefing,
        ort,
        state,
        date,
        dueDate,
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
