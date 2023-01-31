const { ensureUniqueField } = require('@/utils')

const GradualPriceMap = Parse.Object.extend('GradualPriceMap')

function fetchGradualPriceMaps () {
  return $query(GradualPriceMap).find({ useMasterKey: true })
}

Parse.Cloud.beforeSave(GradualPriceMap, async ({ object: gradualPriceMap }) => {
  await ensureUniqueField(gradualPriceMap, 'code')
})

Parse.Cloud.afterSave(GradualPriceMap, async ({ object: gradualPriceMap, context: { audit } }) => {
  $audit(gradualPriceMap, audit)
})

Parse.Cloud.beforeDelete(GradualPriceMap, async ({ object: gradualPriceMap }) => {
  const companiesQuery = $query('Company')
    .include('deleted')
    .equalTo('contractDefaults.gradualPriceMapId', gradualPriceMap.id)
  const companiesCount = await companiesQuery.count({ useMasterKey: true })
  if (companiesCount > 0) {
    throw new Error('Da sind Unternehmen mit den Staffelkonditionen hinterlegt. Bitte löschen Sie zuerst die Staffelkonditionen aus dem Unternehmen.')
  }
})

Parse.Cloud.afterDelete(GradualPriceMap, $deleteAudits)

Parse.Cloud.define('gradual-price-map-save', async ({ params: { id, code, map }, user }) => {
  code = code.trim() || undefined
  if (!id) {
    const newGradualPriceMap = new GradualPriceMap({ code, map })
    const audit = { user, fn: 'gradual-price-map-create' }
    return newGradualPriceMap.save(null, { useMasterKey: true, context: { audit } })
  }

  const gradualPriceMap = await $getOrFail(GradualPriceMap, id)
  const changes = $changes(gradualPriceMap, { code, map })
  if (!changes.code && !changes.map) {
    throw new Error('Keine Änderungen')
  }
  gradualPriceMap.set({ code, map })
  const audit = { user, fn: 'gradual-price-map-update', data: { changes } }
  return gradualPriceMap.save(null, { useMasterKey: true, context: { audit } })
}, $adminOrMaster)

Parse.Cloud.define('gradual-price-map-remove', async ({ params: { id } }) => {
  const gradualPriceMap = await $getOrFail(GradualPriceMap, id)
  return gradualPriceMap.destroy({ useMasterKey: true })
}, $adminOrMaster)

const getGradualPrice = function (total, map) {
  let price = null
  for (const count of Object.keys(map)) {
    if (count <= total) {
      price = map[count]
    } else {
      return price
    }
  }
  return price
}

const getGradualCubeCount = async function (gradualPriceMap, date) {
  const query = $query('Contract')
    .equalTo('gradualPriceMap', gradualPriceMap)
    .greaterThanOrEqualTo('status', 3)
  const dateString = moment(date || await $today()).format('YYYY-MM-DD')
  dateString && query
    .lessThanOrEqualTo('startsAt', dateString)
    .greaterThanOrEqualTo('endsAt', dateString)
  query.select(['cubeCount', 'earlyCancellations'])
  let total = 0
  let i = 0
  while (true) {
    const contracts = await query.skip(i).find({ useMasterKey: true })
    if (!contracts.length) { break }
    for (const contract of contracts) {
      const endedAtDateCount = Object.values(contract.get('earlyCancellations') || {})
        .filter(date => moment(date).isBefore(dateString, 'day'))
        .length
      const contractCount = (contract.get('cubeCount') || 0) - endedAtDateCount
      total += contractCount
    }
    i += contracts.length
  }
  return total
}

const getPredictedCubeGradualPrice = async function (contract, date) {
  const gradualPriceMap = contract.get('gradualPriceMap')
  await gradualPriceMap.fetch({ useMasterKey: true })
  let gradualCount = await getGradualCubeCount(gradualPriceMap, date)
  if (contract.get('status') < 3) {
    gradualCount += contract.get('cubeCount')
  }
  return {
    gradualCount,
    gradualPrice: getGradualPrice(gradualCount, gradualPriceMap.get('map'))
  }
}

module.exports = {
  fetchGradualPriceMaps,
  getGradualPrice,
  getGradualCubeCount,
  getPredictedCubeGradualPrice
}
