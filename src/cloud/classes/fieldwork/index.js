Parse.Cloud.define('fieldwork-map', async ({ user }) => {
  const query = $query(Parse.User)
  user.get('company') && query.equalTo('company', user.get('company'))
  return query
    .select(['objectId', 'location'])
    .notEqualTo('location.gp', null)
    // .greaterThan('location.at', moment().startOf('day').toDate())
    .limit(1000)
    .find({ useMasterKey: true })
    .then(users => users.reduce((acc, user) => {
      acc[user.id] = user.get('location')
      return acc
    }, {}))
}, { requireUser: true })

// used on the map
Parse.Cloud.define('fieldwork-outstanding', async ({ user }) => {
  const response = {}
  const taskListQuery = $query('TaskList')
    .containedIn('status', [2, 3])
    .lessThanOrEqualTo('date', await $today())
  await taskListQuery
    .select(['scouts', 'counts', 'type', 'gp', 'pk', 'briefing', 'control', 'disassembly'])
    .eachBatch((lists) => {
      for (const list of lists) {
        const { completed, total } = list.get('counts')
        const outstanding = total - completed
        if (outstanding <= 0) { continue }
        for (const scout of list.get('scouts')) {
          if (!response[scout.id]) {
            response[scout.id] = {
              lists: [],
              scout: 0,
              control: 0,
              disassembly: 0,
              total: 0
            }
          }
          response[scout.id].lists.push({
            type: list.get('type'),
            outstanding,
            center: list.get('gp'),
            pk: list.get('pk'),
            parentName: list.get('parent').get('name')
          })
          response[scout.id][list.get('type')] += outstanding
          response[scout.id].total += outstanding
        }
      }
    }, { useMasterKey: true })
  return response
}, $fieldworkManager)

Parse.Cloud.define('fieldwork-ongoing', async ({ params: { companyId, force }, user }) => {
  user.get('company') && (companyId = user.get('company').id)
  const isFieldworkManager = user.get('permissions').includes('manage-fieldwork')
  const isScoutManager = user.get('permissions').includes('manage-scouts')
  if (!isFieldworkManager && !isScoutManager) {
    throw new Parse.Error(401, 'Unauthorized')
  }
  const cacheKey = companyId ? 'fieldwork-ongoing-' + companyId : 'fieldwork-ongoing'
  return $cache(cacheKey, {
    async cacheFn () {
      const response = {
        totals: {
          pending: 0,
          rejected: 0,
          approved: 0,
          remaining: 0,
          completed: 0,
          total: 0
        },
        // per scout, type and state
        scouts: {},
        types: {},
        states: {}
      }
      // ongoing
      const taskListQuery = $query('TaskList')
        .containedIn('status', [2, 3])
        .lessThanOrEqualTo('date', await $today())
      let managerQuery
      if (isFieldworkManager) {
        if (companyId === 'intern') {
          managerQuery = $query(Parse.User).equalTo('company', null)
        } else if (companyId) {
          managerQuery = $query(Parse.User).equalTo('company', $parsify('Company', companyId))
        }
      } else if (isScoutManager) {
        managerQuery = $query(Parse.User).equalTo('company', user.get('company'))
      }
      managerQuery && taskListQuery.matchesQuery('manager', managerQuery)
      await taskListQuery
        .select(['scouts', 'counts', 'type', 'state'])
        .eachBatch((lists) => {
          for (const list of lists) {
            // if a scout is not selected, but the list is assigned/in progress, something is off.
            if (!list.get('scouts')?.length) {
              consola.error('Assigned/In progress TaskList with no scout: ' + list.id)
              continue
            }
            const { rejected, pending, approved, completed, total } = list.get('counts')
            const listCounts = {
              rejected: rejected || 0,
              pending: pending || 0,
              approved: approved || 0,
              completed: completed || 0,
              total: total || 0
            }
            listCounts.remaining = listCounts.total - listCounts.completed
            if (listCounts.remaining < 0) { listCounts.remaining = 0 }

            const { type, state: { id: stateId } } = list.attributes
            !(response.types[type]) && (response.types[type] = {})
            !(response.states[stateId]) && (response.states[stateId] = {})
            for (const scout of list.get('scouts')) {
              !(response.scouts[scout.id]) && (response.scouts[scout.id] = {})
            }
            for (const key of ['rejected', 'pending', 'approved', 'completed', 'remaining', 'total']) {
              response.totals[key] = (response.totals[key] || 0) + listCounts[key]
              response.types[type][key] = (response.types[type][key] || 0) + listCounts[key]
              response.states[stateId][key] = (response.states[stateId][key] || 0) + listCounts[key]
              for (const scout of list.get('scouts')) {
                response.scouts[scout.id][key] = (response.scouts[scout.id][key] || 0) + listCounts[key]
              }
            }
          }
        }, { useMasterKey: true })
      return response
    },
    maxAge: [2, 'minutes'],
    force
  })
}, { requireUser: true })

Parse.Cloud.define('fieldwork-upcoming', async ({ params: { force } }) => {
  return $cache('fieldwork-upcoming', {
    async cacheFn () {
      const months = [0, 1, 2, 3].map((add) => {
        const m = moment().add(add, 'months')
        return {
          key: m.format('MMMM YYYY'),
          start: m.startOf('month').format('YYYY-MM-DD'),
          end: m.endOf('month').format('YYYY-MM-DD')
        }
      })

      const response = {}
      const getBaseQuery = () => $query('TaskList')
        .greaterThan('status', 0)
        .lessThan('status', 4)
        .select(['type', 'counts.total', 'status', 'state'])
      for (const { key, start, end } of months) {
        response[key] = {}
        const query = getBaseQuery()
        end && query.lessThanOrEqualTo('date', end)
        start && query.greaterThanOrEqualTo('date', start)
        await query.eachBatch((lists) => {
          for (const list of lists) {
            const stateId = list.get('state').id
            const type = list.get('type')
            const status = list.get('status')
            const total = list.get('counts').total
            if (!response[key][stateId]) {
              response[key][stateId] = {
                stateId,
                scout: {},
                control: {},
                disassembly: {},
                total: {}
              }
            }
            response[key][stateId][type][status] = (response[key][stateId][type][status] || 0) + total
            response[key][stateId][type].total = (response[key][stateId][type].total || 0) + total
            response[key][stateId].total[status] = (response[key][stateId].total[status] || 0) + total
            response[key][stateId].total.total = (response[key][stateId].total.total || 0) + total
          }
        }, { useMasterKey: true })
      }
      return response
    },
    maxAge: [10, 'minutes'],
    force
  })
}, $fieldworkManager)

Parse.Cloud.define('fieldwork-approved-submissions', async ({ params: { companyId, force }, user }) => {
  user.get('company') && (companyId = user.get('company').id)
  const isFieldworkManager = user.get('permissions').includes('manage-fieldwork')
  const isScoutManager = user.get('permissions').includes('manage-scouts')
  if (!isFieldworkManager && !isScoutManager) {
    throw new Parse.Error(401, 'Unauthorized')
  }
  const cacheKey = companyId ? 'fieldwork-approved-submissions-' + companyId : 'fieldwork-approved-submissions'
  return $cache(cacheKey, {
    async cacheFn () {
      const response = {}
      const months = [0, 1, 2, 3].map((subtract) => {
        const m = moment().subtract(subtract, 'months')
        return {
          key: m.format('MMMM YYYY'),
          start: m.startOf('month').toDate(),
          end: m.endOf('month').toDate()
        }
      })

      let scoutsQuery
      if (companyId === 'intern') {
        scoutsQuery = $query(Parse.User).equalTo('company', null)
      } else if (companyId) {
        scoutsQuery = $query(Parse.User).equalTo('company', $parsify('Company', companyId))
      }
      for (const { key, start, end } of months) {
        response[key] = {}
        for (const type of ['Scout', 'Control', 'Disassembly']) {
          const query = $query(type + 'Submission')
          scoutsQuery && query.matchesQuery('scout', scoutsQuery)
          await query
            .greaterThanOrEqualTo('createdAt', start)
            .lessThanOrEqualTo('createdAt', end)
            .equalTo('status', 'approved')
            .select('scout')
            .eachBatch((submissions) => {
              for (const submission of submissions) {
                const scoutId = submission.get('scout').id
                if (!response[key][scoutId]) {
                  response[key][scoutId] = {
                    scoutId,
                    scout: 0,
                    control: 0,
                    disassembly: 0,
                    total: 0
                  }
                }
                response[key][scoutId][type.toLowerCase()]++
                response[key][scoutId].total++
              }
            }, { useMasterKey: true })
        }
      }
      return response
    },
    maxAge: [10, 'minutes'],
    force
  })
}, { requireUser: true })

Parse.Cloud.define('fieldwork-parent-statuses', async ({ params: { itemClass, itemId }, user }) => {
  const parent = await $getOrFail(itemClass, itemId)
  const getTaskListsQuery = () => $query('TaskList').equalTo(itemClass.toLowerCase(), parent)
  const statuses = {}
  await getTaskListsQuery()
    .select('status')
    .eachBatch(async (lists) => {
      for (const list of lists) {
        const status = list.get('status')
        statuses[status] = (statuses[status] || 0) + 1
      }
    }, { useMasterKey: true })
  return statuses
}, $fieldworkManager)

Parse.Cloud.define('fieldwork-parent-archive', async ({ params: { itemClass, itemId }, user }) => {
  const parent = await $getOrFail(itemClass, itemId)
  let i = 0
  const getTaskListsQuery = () => $query('TaskList').equalTo(itemClass.toLowerCase(), parent)

  if (await getTaskListsQuery().equalTo('status', 0).count({ useMasterKey: true })) {
    throw new Parse.Error(400, 'Draft task lists cannot be archived')
  }
  const sessionToken = user.getSessionToken()
  await getTaskListsQuery()
    .equalTo('archivedAt', null)
    .select('objectId')
    .eachBatch(async (lists) => {
      for (const list of lists) {
        await Parse.Cloud.run('task-list-mark-complete', { id: list.id, skipSyncParentStatus: true }, { sessionToken })
        await Parse.Cloud.run('task-list-archive', { id: list.id, skipSyncParentStatus: true }, { sessionToken })
        i++
      }
    }, { useMasterKey: true })
  const audit = { fn: 'fieldwork-parent-archive', user, data: { i } }
  await parent.save(null, { useMasterKey: true, context: { audit, syncStatus: true } })
  return i
}, $fieldworkManager)
