Parse.Cloud.define('scout-manager-summary', async ({ user }) => {
  if (!user.get('permissions')?.includes('manage-scouts')) {
    return
  }
  const today = await $today()
  const getBaseQuery = () => $query('TaskList').equalTo('manager', user)
  const needsToBeAssigned = await getBaseQuery()
    .equalTo('status', 1)
    .lessThanOrEqualTo('date', today)
    .count({ useMasterKey: true })

  const totals = {
    lists: 0,
    pending: 0,
    rejected: 0,
    approved: 0,
    remaining: 0,
    completed: 0,
    total: 0,
    scouts: {},
    types: {
      scout: 0,
      control: 0,
      disassembly: 0
    }
  }
  await getBaseQuery()
    .containedIn('status', [2, 3])
    .select(['scouts', 'counts', 'type'])
    .eachBatch((lists) => {
      for (const list of lists) {
        totals.lists++
        const { rejected, pending, approved, completed, total } = list.get('counts')
        totals.rejected += rejected || 0
        totals.pending += pending || 0
        totals.approved += approved || 0
        totals.completed += completed || 0
        totals.total += total || 0
        const remaining = total - completed
        totals.remaining += remaining
        totals.types[list.get('type')] += total || 0
        for (const scout of list.get('scouts')) {
          !(totals.scouts[scout.id]) && (totals.scouts[scout.id] = 0)
          totals.scouts[scout.id] += remaining
        }
      }
    }, { useMasterKey: true })

  totals.scouts = Object.keys(totals.scouts).reduce((scouts, scoutId) => {
    scouts.push({
      scoutId,
      value: totals.scouts[scoutId]
    })
    return scouts
  }, [])

  totals.types = Object.keys(totals.types).reduce((types, type) => {
    types.push({
      type,
      value: totals.types[type]
    })
    return types
  }, [])

  totals.completionPercentage = totals.total ? Math.round((totals.completed / totals.total) * 100) : 100

  return {
    needsToBeAssigned,
    totals
  }
}, { requireUser: true })

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

Parse.Cloud.define('fieldwork-outstanding', async () => {
  const response = {}
  const manager = null
  // ongoing
  const taskListQuery = $query('TaskList').containedIn('status', [2, 3])
  manager && taskListQuery.equalTo('manager', manager)
  await taskListQuery
    .select(['scouts', 'counts', 'type', 'gp'])
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
            center: list.get('gp')
          })
          response[scout.id][list.get('type')] += outstanding
          response[scout.id].total += outstanding
        }
      }
    }, { useMasterKey: true })
  return response
}, { requireUser: true })

Parse.Cloud.define('fieldwork-upcoming', async () => {
  const reached = {
    key: 'Erreicht',
    end: moment().format('YYYY-MM-DD')
  }
  const months = [reached, ...[0, 1, 2, 3].map((add) => {
    const m = moment().add(add, 'months')
    return {
      key: m.format('MMMM YYYY'),
      start: m.startOf('month').format('YYYY-MM-DD'),
      end: m.endOf('month').format('YYYY-MM-DD')
    }
  })]

  const response = {}
  // needs to be assigned
  const getBaseQuery = () => $query('TaskList').equalTo('status', 1).select(['type', 'counts.total'])
  for (const { key, start, end } of months) {
    response[key] = {
      scout: 0,
      control: 0,
      disassembly: 0,
      total: 0
    }
    const query = getBaseQuery()
    end && query.lessThanOrEqualTo('date', end)
    start && query.greaterThanOrEqualTo('date', start)
    console.log({ end, start })
    await query.eachBatch((lists) => {
      consola.info(lists)
      for (const list of lists) {
        const type = list.get('type')
        const total = list.get('counts').total
        response[key][type] += total
        response[key].total += total
      }
    }, { useMasterKey: true })
  }
  return response
}, $fieldworkManager)

Parse.Cloud.define('fieldwork-approved-submissions', async () => {
  const response = {}
  const months = [0, 1, 2, 3].map((subtract) => {
    const m = moment().subtract(subtract, 'months')
    return {
      key: m.format('MMMM YYYY'),
      start: m.startOf('month').toDate(),
      end: m.endOf('month').toDate()
    }
  })
  for (const { key, start, end } of months) {
    response[key] = {}
    for (const type of ['Scout', 'Control', 'Disassembly']) {
      await $query(type + 'Submission')
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
}, $fieldworkManager)
