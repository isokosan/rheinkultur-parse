const { geMonthYearStartEnd } = require('@/shared')

const Disassembly = Parse.Object.extend('Disassembly')
const DepartureList = Parse.Object.extend('DepartureList')

Parse.Cloud.afterSave(Disassembly, ({ object: disassembly, context: { audit } }) => { $audit(disassembly, audit) })

Parse.Cloud.beforeFind(Disassembly, ({ query }) => {
  query._include.includes('all') && query.include(['departureLists', 'docs'])
})

Parse.Cloud.afterFind(Disassembly, async ({ query, objects: disassemblies }) => {
  for (const disassembly of disassemblies) {
    const { start: periodStart, end: periodEnd } = geMonthYearStartEnd(disassembly.get('name'))
    disassembly.set({ periodStart, periodEnd })
  }
  if (query._include.includes('departureLists')) {
    const departureLists = await $query(DepartureList).containedIn('disassembly', disassemblies).limit(1000).find({ useMasterKey: true })
    for (const disassembly of disassemblies) {
      disassembly.set('departureLists', departureLists.filter(s => s.get('disassembly').id === disassembly.id))
    }
  }
  if (query._include.includes('departureListCount')) {
    for (const disassembly of disassemblies) {
      disassembly.set('departureListCount', await $query(DepartureList).equalTo('disassembly', disassembly).count({ useMasterKey: true }))
    }
  }
})

Parse.Cloud.afterDelete(Disassembly, $deleteAudits)

// Parse.Cloud.define('disassembly-create', async ({
//   params: {
//     name
//   }, user
// }) => {
//   const disassembly = new Disassembly({
//     name
//   })

//   const audit = { user, fn: 'disassembly-create' }
//   return disassembly.save(null, { useMasterKey: true, context: { audit } })
// }, {
//   requireUser: true,
//   fields: {
//     name: {
//       type: String,
//       required: true
//     }
//   }
// })

// Parse.Cloud.define('disassembly-update', async ({
//   params: {
//     id: disassemblyId
//   }, user
// }) => {
//   const control = await $getOrFail(Control, controlId)
//   const changes = $changes(control, { name, date })
//   control.set({ name, date })
//   // await $getOrFail(sourceClass, sourceId)
//   // control.set({ sourceClass, sourceId })
//   const audit = { user, fn: 'control-update', data: { changes } }
//   return control.save(null, { useMasterKey: true, context: { audit } })
// }, {
//   requireUser: true,
//   fields: {
//     name: {
//       type: String,
//       required: true
//     },
//     sourceClass: {
//       type: String,
//       required: true
//     },
//     sourceId: {
//       type: String,
//       required: true
//     }
//   }
// })

// TODO: limits
Parse.Cloud.define('disassembly-collect-cubes', async ({ params: { id: disassemblyId } }) => {
  const disassembly = await $getOrFail(Disassembly, disassemblyId)
  const periodStart = disassembly.get('periodStart')
  const periodEnd = disassembly.get('periodEnd')

  const endingQuery = Parse.Query.or(
    $query('Cube').notEqualTo('order.canceledAt', null),
    $query('Cube').notEqualTo('order.earlyCanceledAt', null),
    $query('Cube').equalTo('order.autoExtendsAt', null)
  )
  const contractsQuery = $query('Contract').equalTo('disassembly', true)
  const bookingsQuery = $query('Booking').equalTo('disassembly', true)
  const disassemblyQuery = Parse.Query.or(
    $query('Cube').matchesKeyInQuery('order.contract.objectId', 'objectId', contractsQuery),
    $query('Cube').matchesKeyInQuery('order.booking.objectId', 'objectId', bookingsQuery)
  )
  return Parse.Query.and(endingQuery, disassemblyQuery)
    .notEqualTo('order', null)
    .greaterThanOrEqualTo('order.endsAt', periodStart)
    .lessThanOrEqualTo('order.endsAt', periodEnd)
    .ascending('order.endsAt')
    .addAscending('objectId')
    .addAscending('ort')
    .addAscending('str')
    .addAscending('hsnr')
    .find({ useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('disassembly-generate-lists', async ({ params: { id: disassemblyId }, user }) => {
  // TODO: limit
  const disassembly = await $getOrFail(Disassembly, disassemblyId)
  const cubes = await Parse.Cloud.run('disassembly-collect-cubes', { id: disassemblyId }, { useMasterKey: true })

  const stateCubeIds = {}
  for (const cube of cubes) {
    const stateId = cube.get('state')?.id
    if (!stateCubeIds[stateId]) {
      stateCubeIds[stateId] = []
    }
    stateCubeIds[stateId].push(cube.id)
  }
  for (const stateId of Object.keys(stateCubeIds)) {
    const state = await $getOrFail('State', stateId)
    let departureList = await $query('DepartureList')
      .equalTo('disassembly', disassembly)
      .equalTo('state', state)
      .first({ useMasterKey: true })
    if (!departureList) {
      const name = `${disassembly.get('name')} (${state.get('name')})`
      departureList = new DepartureList({
        name,
        type: 'disassembly',
        disassembly,
        state,
        cubeIds: stateCubeIds[stateId]
      })
      const audit = { user, fn: 'departure-list-generate' }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
      continue
    }
    const cubeIds = [...new Set([...(departureList.get('cubeIds') || []), ...stateCubeIds[stateId]])]
    const cubeChanges = $cubeChanges(departureList, cubeIds)
    if (cubeChanges) {
      departureList.set({ cubeIds })
      const audit = { user, fn: 'departure-list-update', data: { cubeChanges } }
      await departureList.save(null, { useMasterKey: true, context: { audit } })
    }
  }
  return true
}, { requireUser: true })

// TODO: Better if disassemblies cannot be deleted
// Parse.Cloud.define('control-remove', async ({ params: { id: controlId }, user, context: { seedAsId } }) => {
//   const control = await $getOrFail(Control, controlId)
//   if (control.get('status')) {
//     throw new Error('Only draft controls can be deleted!')
//   }
//   while (true) {
//     const departureLists = await $query('DepartureList')
//       .equalTo('control', control)
//       .find({ useMasterKey: true })
//     if (!departureLists.length) {
//       break
//     }
//     await Promise.all(departureLists.map((sl) => {
//       return sl.get('status')
//         ? sl.unset('control').save(null, { useMasterKey: true })
//         : sl.destroy({ useMasterKey: true })
//     }))
//   }
//   return control.destroy({ useMasterKey: true })
// }, { requireUser: true })

// Update booking or contract disassembly from RMV
Parse.Cloud.define('disassembly-order-update', async ({
  params: {
    className,
    id,
    disassembly
  }, user
}) => {
  const bc = await $query(className).get(id, { useMasterKey: true })
  const changes = $changes(bc, { disassembly })
  bc.set({ disassembly })
  const audit = { user, fn: className.toLowerCase() + '-update', data: { changes } }
  return bc.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })
