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

Parse.Cloud.define('user-location', async ({ params: { latitude, longitude, accuracy, heading, speed }, user }) => {
  user
    .set('location', {
      gp: $geopoint(latitude, longitude),
      accuracy,
      heading,
      speed,
      at: new Date()
    })
    .save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('scout-locations', async ({ user }) => {
  const query = $query(Parse.User)
  user.get('company') && query.equalTo('company', user.get('company'))
  return query
    .select(['objectId', 'location'])
    .notEqualTo('location.gp', null)
    .greaterThan('location.at', moment().startOf('day').toDate())
    .limit(1000)
    .find({ useMasterKey: true })
    .then(users => users.reduce((acc, user) => {
      acc[user.id] = user.get('location')
      return acc
    }, {}))
}, { requireUser: true })
