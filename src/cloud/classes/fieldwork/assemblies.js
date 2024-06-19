const axios = require('axios')
const { lowerFirst } = require('lodash')
const { ORDER_CLASSES } = require('@/shared')

const Assembly = Parse.Object.extend('Assembly')
const TaskList = Parse.Object.extend('TaskList')
// const AssemblySubmission = Parse.Object.extend('AssemblySubmission')
const { getStatusAndCounts } = require('./task-lists')

Parse.Cloud.beforeSave(Assembly, async ({ object: assembly, context: { syncStatus } }) => {
  const [className, objectId] = assembly.id.split('-')
  assembly.set('orderKey', [className, objectId].join('-'))
  !assembly.get('status') && assembly.set('status', 1)
  assembly.unset('order') // make sure not to persist in DB
  if (assembly.isNew()) { return }

  if (syncStatus || !assembly.get('counts')) {
    const { status, counts } = await getStatusAndCounts({ assembly })
    // TODO: if changing add audit
    assembly.set({ status, counts })
  }
})

Parse.Cloud.beforeFind(Assembly, ({ query }) => {
  query.include(ORDER_CLASSES.map(lowerFirst))
})

Parse.Cloud.afterFind(Assembly, async ({ query, objects: assemblies }) => {
  // assembly tasks
  const pipeline = [
    { $match: { _p_assembly: { $in: assemblies.map(c => 'Assembly' + c.id) } } },
    { $group: { _id: '$assembly', taskListCount: { $sum: 1 }, cubeCount: { $sum: '$cubeCount' } } }
  ]
  const counts = await $query(TaskList).aggregate(pipeline)
    .then(response => response.reduce((acc, { objectId, taskListCount, cubeCount }) => ({ ...acc, [objectId]: { taskListCount, cubeCount } }), {}))
  for (const assembly of assemblies) {
    assembly.set(counts[assembly.id])
    const order = ORDER_CLASSES.map(className => assembly.get(lowerFirst(className))).find(Boolean)
    if (!order) {
      consola.error(assembly.get('orderKey'))
      continue
    }
    assembly.set('order', order)
    assembly.set('company', order.get('company'))
  }
})

async function checkActiveTaskListsExists ({ order, className, assembly }) {
  if ((!order || !className) && !assembly) {
    throw new Error('Either order or assembly must be provided.')
  }
  const query = $query(TaskList)
  if (order) {
    const orderKey = order.className + '-' + order.id
    query.matchesQuery('assembly', $query(Assembly).equalTo('orderKey', orderKey))
  }
  assembly && query.equalTo('assembly', assembly)
  // check if there are any task lists that are assigned
  const activeLists = await query.greaterThanOrEqualTo('status', 1).include('scouts').find({ useMasterKey: true })
  for (const taskList of activeLists) {
    // notify fieldwork manager about changes
    await $notify({
      usersQuery: $query(Parse.User).equalTo('permissions', 'manage-fieldwork'),
      identifier: 'assembly-canceled',
      data: { taskListId: taskList.id, placeKey: taskList.get('pk'), status: taskList.get('status') }
    })
  }
  if (activeLists.length) {
    throw new Error('There are active task lists for this assembly.')
  }
}

// TODO: Make sure status of Assembly is saved and updated?
Parse.Cloud.beforeDelete(Assembly, async ({ object: assembly }) => {
  await checkActiveTaskListsExists({ assembly })
  await $query(TaskList)
    .equalTo('assembly', assembly)
    .lessThan('status', 1)
    .each(list => list.destroy({ useMasterKey: true }), { useMasterKey: true })
})

async function ensureAssemblyExists (order, date, dueDate) {
  const assemblyKey = order.className + '-' + order.id
  const exists = await $query(Assembly)
    .equalTo('objectId', assemblyKey)
    .first({ useMasterKey: true })
  if (exists) {
    return exists
  }
  await axios({
    method: 'POST',
    url: `${process.env.PUBLIC_SERVER_URL}/classes/Assembly`,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Master-Key': process.env.MASTER_KEY
    },
    data: {
      objectId: assemblyKey,
      [lowerFirst(order.className)]: $pointer(order.className, order.id),
      date,
      dueDate
    }
  })
  return $getOrFail('Assembly', assemblyKey)
}

Parse.Cloud.define('assembly-generate', async ({ params: { className, objectId }, user }) => {
  const order = await $getOrFail(className, objectId, 'production')
  const production = order.get('production')
  const date = production.get('assemblyStart')
  const dueDate = production.get('dueDate')
  const assembly = await ensureAssemblyExists(order, date, dueDate)
  assembly.set('date', date)
  assembly.set('dueDate', dueDate)
  await assembly.save(null, { useMasterKey: true })

  // make sure each list exists
  // TODO: make sure early canceled cubes === true are removed from assembly if not already assembled
  const mainCubeIds = order.get('cubeIds').filter(cubeId => order.get('earlyCancellations')?.[cubeId] !== true)
  const mainLists = await $query('Cube')
    .containedIn('objectId', mainCubeIds)
    .select('pk')
    .limit(mainCubeIds.length)
    .find({ useMasterKey: true })
    .then(cubes => cubes.reduce((acc, cube) => {
      const pk = cube.get('pk')
      if (!acc[pk]) { acc[pk] = [] }
      acc[pk].push(cube.id)
      return acc
    }, {}))
  for (const [pk, cubeIds] of Object.entries(mainLists)) {
    const { ort, state } = $parsePk(pk)
    // check if taskList exists
    let taskList = await $query(TaskList)
      .equalTo('type', 'assembly')
      .equalTo('assembly', assembly)
      .equalTo('pk', pk)
      .first({ useMasterKey: true })
    if (!taskList) {
      taskList = new TaskList({
        type: 'assembly',
        assembly,
        status: 0.1, // generate as planned
        ort,
        state,
        cubeIds,
        date,
        dueDate
      })
      const audit = { user, fn: 'assembly-generate' }
      await taskList.save(null, { useMasterKey: true, context: { audit } })
      continue
    }
    const changes = $changes(taskList, { cubeIds, date, dueDate })
    if (changes) {
      const audit = { user, fn: 'assembly-update', changes }
      await taskList
        .set({ cubeIds, date, dueDate })
        .save(null, { useMasterKey: true, context: { audit } })
    }
  }
  return assembly
}, $internOrAdmin)

Parse.Cloud.define('assembly-photos', async ({ params: { className, objectId, cubeId } }) => {
  const response = {}
  const scope = `assembly-${className[0]}-${objectId}`
  const scopeQuery = $query('CubePhoto').equalTo('scope', scope)
  cubeId && scopeQuery.equalTo('cubeId', cubeId)
  await scopeQuery
    .eachBatch((photos) => {
      for (const photo of photos) {
        const cubeId = photo.get('cubeId')
        if (!response[cubeId]) {
          response[cubeId] = []
        }
        response[cubeId].push(photo)
      }
    }, { useMasterKey: true })

  const scopes = []
  // append assembly form photos in any case
  if (className === 'SpecialFormat') {
    const specialFormat = await $getOrFail(className, objectId, 'customService')
    const customService = specialFormat.get('customService')
    const taskListsQuery = $query('TaskList').equalTo('customService', customService)
    cubeId && taskListsQuery.equalTo('cubeIds', cubeId)
    const taskListIds = await taskListsQuery.distinct('objectId', { useMasterKey: true })
    scopes.push(...taskListIds.map(id => 'special-format-TL-' + id))
  } else {
    const orderKey = [className, objectId].join('-')
    const taskListsQuery = $query('TaskList').equalTo('assembly', $parsify('Assembly', orderKey))
    cubeId && taskListsQuery.equalTo('cubeIds', cubeId)
    const taskListIds = await taskListsQuery.distinct('objectId', { useMasterKey: true })
    scopes.push(...taskListIds.map(id => 'assembly-TL-' + id))
  }
  await $query('CubePhoto')
    .containedIn('scope', scopes)
    .eachBatch((photos) => {
      for (const photo of photos) {
        const cubeId = photo.get('cubeId')
        if (!response[cubeId]) {
          response[cubeId] = []
        }
        response[cubeId].push(photo)
      }
    }
    , { useMasterKey: true })
  return cubeId ? response[cubeId] : response
}, { requireUser: true })

Parse.Cloud.define('assembly-report', async ({ params: { id: productionId } }) => {
  const production = await $getOrFail('Production', productionId)
  const order = production.get('order')
  // append assembly form photos in any case
  console.log(order.get('cubeIds'))
  const submissionsQuery = $query('AssemblySubmission').containedIn('cube', order.get('cubeIds').map(id => $parsify('Cube', id)))
  if (order.className === 'SpecialFormat') {
    const customService = order.get('customService')
    const taskListsQuery = $query('TaskList').equalTo('customService', customService)
    submissionsQuery.matchesQuery('taskList', taskListsQuery)
  } else {
    const orderKey = [order.className, order.id].join('-')
    const taskListsQuery = $query('TaskList').equalTo('assembly', $parsify('Assembly', orderKey))
    submissionsQuery.matchesQuery('taskList', taskListsQuery)
  }
  const submissions = {}
  await submissionsQuery.include('photos').select(['status', 'cube', 'photos', 'result']).eachBatch((batch) => {
    for (const submission of batch) {
      submissions[submission.get('cube').id] = submission.toJSON()
    }
  }, { useMasterKey: true })
  return {
    production,
    order,
    submissions
  }
})
