const Control = Parse.Object.extend('Control')
const DepartureList = Parse.Object.extend('DepartureList')

Parse.Cloud.afterSave(Control, ({ object: control, context: { audit } }) => { $audit(control, audit) })

Parse.Cloud.beforeFind(Control, ({ query }) => {
  query._include.includes('all') && query.include(['company', 'companyPerson', 'departureLists', 'docs'])
})

Parse.Cloud.afterFind(Control, async ({ query, objects: controls }) => {
  for (const control of controls) {
    control.set('source', await $getOrFail(control.get('sourceClass'), control.get('sourceId')))
  }
  if (query._include.includes('departureLists')) {
    const departureLists = await $query(DepartureList).containedIn('control', controls).limit(1000).find({ useMasterKey: true })
    for (const control of controls) {
      control.set('departureLists', departureLists.filter(s => s.get('control').id === control.id))
    }
  }
  if (query._include.includes('departureListCount')) {
    for (const control of controls) {
      control.set('departureListCount', await $query(DepartureList).equalTo('control', control).count({ useMasterKey: true }))
    }
  }
})

Parse.Cloud.afterDelete(Control, $deleteAudits)

Parse.Cloud.define('control-create', async ({
  params: {
    name,
    date,
    sourceClass,
    sourceId
  }, user
}) => {
  const control = new Control({
    name,
    date,
    sourceClass,
    sourceId
  })

  const audit = { user, fn: 'control-create' }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, {
  requireUser: true,
  fields: {
    name: {
      type: String,
      required: true
    },
    sourceClass: {
      type: String,
      required: true
    },
    sourceId: {
      type: String,
      required: true
    }
  }
})

Parse.Cloud.define('control-update', async ({
  params: {
    id: controlId,
    name,
    date,
    sourceClass,
    sourceId
  }, user
}) => {
  const control = await $getOrFail(Control, controlId)
  const changes = $changes(control, { name, date })
  control.set({ name, date })
  // await $getOrFail(sourceClass, sourceId)
  // control.set({ sourceClass, sourceId })
  const audit = { user, fn: 'control-update', data: { changes } }
  return control.save(null, { useMasterKey: true, context: { audit } })
}, {
  requireUser: true,
  fields: {
    name: {
      type: String,
      required: true
    },
    sourceClass: {
      type: String,
      required: true
    },
    sourceId: {
      type: String,
      required: true
    }
  }
})

// TODO: test with order structure
Parse.Cloud.define('control-source', async ({ params: { sourceClass, sourceId, date } }) => {
  if (!date) {
    date = await $today()
  }
  if (!sourceClass) {
    throw new Error('No Source')
  }
  let cubesQuery
  if (sourceClass === 'Tag') {
    const tag = await $getOrFail('Tag', sourceId)
    // get all tag contracts & bookings active at this date
    const contractsQuery = $query('Contract').equalTo('tags', tag).greaterThan('status', 2)
    const bookingsQuery = $query('Booking').equalTo('tags', tag).greaterThan('status', 2)
    cubesQuery = Parse.Query.or(
      $query('Cube').matchesKeyInQuery('order.contract.objectId', 'objectId', contractsQuery),
      $query('Cube').matchesKeyInQuery('order.booking.objectId', 'objectId', bookingsQuery)
    )
  }
  // TODO: Add ends at date, to filter out early canceled cubes or non-extending cubes.
  if (sourceClass === 'Company') {
    const company = await $getOrFail('Company', sourceId)
    cubesQuery = $query('Cube').equalTo('order.company', company).greaterThan('order.status', 2)
  }
  if (sourceClass === 'Contract') {
    cubesQuery = $query('Cube').equalTo('order.contract.objectId', sourceId).greaterThan('order.status', 2)
  }
  if (sourceClass === 'Booking') {
    cubesQuery = $query('Cube').equalTo('order.booking.objectId', sourceId).greaterThan('order.status', 2)
  }
  return cubesQuery.distinct('objectId', { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('control-add-lists', async ({ params: { id: controlId, lists }, user }) => {
  const control = await $getOrFail(Control, controlId)
  for (const stateId of Object.keys(lists || {})) {
    const placeKey = '_' + stateId
    let departureList = await $query('DepartureList')
      .equalTo('control', control)
      .equalTo('placeKey', placeKey)
      .first({ useMasterKey: true })
    if (!departureList) {
      const [, stateId] = placeKey.split('_')
      const state = await $getOrFail('State', stateId)
      const name = `${control.get('name')} (${state.get('name')})`
      consola.info({ name })
      departureList = new DepartureList({
        name,
        type: 'control',
        control,
        placeKey,
        cubeIds: lists[stateId]
      })
      const audit = { user, fn: 'departure-list-generate' }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
      continue
    }
    const cubeIds = [...new Set([...(departureList.get('cubeIds') || []), ...lists[stateId]])]
    const cubeChanges = $cubeChanges(departureList, cubeIds)
    if (cubeChanges) {
      departureList.set({ cubeIds })
      const audit = { user, fn: 'departure-list-update', data: { cubeChanges } }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  return true
}, { requireUser: true })

Parse.Cloud.define('control-remove', async ({ params: { id: controlId }, user, context: { seedAsId } }) => {
  const control = await $getOrFail(Control, controlId)
  if (control.get('status')) {
    throw new Error('Only draft controls can be deleted!')
  }
  while (true) {
    const departureLists = await $query('DepartureList')
      .equalTo('control', control)
      .find({ useMasterKey: true })
    if (!departureLists.length) {
      break
    }
    await Promise.all(departureLists.map((sl) => {
      return sl.get('status')
        ? sl.unset('control').save(null, { useMasterKey: true })
        : sl.destroy({ useMasterKey: true })
    }))
  }
  return control.destroy({ useMasterKey: true })
}, { requireUser: true })
