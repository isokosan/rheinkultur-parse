require('./run')(async () => {
  // for (const quarter of [
  //   'Q2',
  //   'Q3',
  //   'Q4'
  // ]) {
  //   const date = moment().quarter(quarter.slice(1)).startOf('quarter').format('YYYY-MM-DD')
  //   const name = 'Groupm ' + quarter + '-2024 TEST'
  //   const dueDate = moment(date).endOf('quarter').format('YYYY-MM-DD')
  //   const untilDate = moment(dueDate).add(1, 'month').format('YYYY-MM-DD')
  //   const startedBefore = moment(date).subtract(6, 'months').format('YYYY-MM-DD')
  //   const lastControlBefore = 12 // 12 months before start date
  //   const lastControlAt = moment(date).subtract(lastControlBefore, 'months').format('YYYY-MM-DD')
  //   const orderType = 'Contract'
  //   const criteria = [{ type: 'Company', value: 'FNFCxMgEEr', op: 'include' }]
  //   await Parse.Cloud.run('control-create', { name, criteria, orderType, date, dueDate, startedBefore, lastControlBefore, lastControlAt, untilDate }, { useMasterKey: true })
  // }
  // for (const quarter of [
  //   'Q1',
  //   'Q2',
  //   'Q3',
  //   'Q4'
  // ]) {
  //   const date = moment().quarter(quarter.slice(1)).year(2025).startOf('quarter').format('YYYY-MM-DD')
  //   const name = 'Groupm ' + quarter + '-2025 TEST'
  //   const dueDate = moment(date).endOf('quarter').format('YYYY-MM-DD')
  //   const untilDate = moment(dueDate).add(1, 'month').format('YYYY-MM-DD')
  //   const startedBefore = moment(date).subtract(6, 'months').format('YYYY-MM-DD')
  //   const lastControlBefore = 12 // 12 months before start date
  //   const lastControlAt = moment(date).subtract(lastControlBefore, 'months').format('YYYY-MM-DD')
  //   const orderType = 'Contract'
  //   const criteria = [{ type: 'Company', value: 'FNFCxMgEEr', op: 'include' }]
  //   await Parse.Cloud.run('control-create', { name, criteria, orderType, date, dueDate, startedBefore, lastControlBefore, lastControlAt, untilDate }, { useMasterKey: true })
  // }

  const kinetic = await $getOrFail('Company', 'FNFCxMgEEr')
  const today = await $today()
  const { difference } = require('lodash')
  const quarterly = {
    Q1: 0,
    Q2: 0,
    Q3: 0,
    Q4: 0
  }
  const contractCubeIds = []
  await $query('Contract')
    .equalTo('company', kinetic)
    .equalTo('status', 3)
    .greaterThan('endsAt', moment(await $today()).format('YYYY-MM-DD')) // not a past order
    .lessThanOrEqualTo('startsAt', moment(await $today()).format('YYYY-MM-DD')) // not a future order
    .select(['startsAt', 'cubeIds', 'earlyCancellations'])
    .eachBatch(async (contracts) => {
      for (const contract of contracts) {
        const { startsAt, cubeIds, earlyCancellations } = contract.attributes
        const quarter = 'Q' + moment(startsAt).format('Q')
        const earlyCanceledIds = Object.keys(earlyCancellations || {})
          .filter(id => earlyCancellations[id] === true || earlyCancellations[id] <= today)
        const active = difference(cubeIds, earlyCanceledIds)
        if (active.length !== cubeIds.length - earlyCanceledIds.length) {
          consola.warn(contract.id)
        }
        quarterly[quarter] += (active.length)
        contractCubeIds.push(...active)
      }
    }, { useMasterKey: true })
  console.log(quarterly, Object.values(quarterly).reduce((a, b) => a + b, 0))

  const allIds = await $query('Cube')
    .equalTo('order.company.objectId', 'FNFCxMgEEr')
    .equalTo('order.className', 'Contract')
    .distinct('objectId', { useMasterKey: true })
  const diff = difference(allIds, contractCubeIds)
  console.log('Total kinetic cubes', allIds.length, 'Contract cubes', contractCubeIds.length, 'Difference', diff)

  const extendingContractCubeIds = []
  const quarterlyE = {
    Q1: 0,
    Q2: 0,
    Q3: 0,
    Q4: 0
  }
  await $query('Contract')
    .equalTo('company', kinetic)
    .equalTo('status', 3)
    .equalTo('canceledAt', null)
    .notEqualTo('autoExtendsBy', null)
    .greaterThan('endsAt', moment(await $today()).format('YYYY-MM-DD')) // not a past order
    .lessThanOrEqualTo('startsAt', moment(await $today()).format('YYYY-MM-DD')) // not a future order
    .select(['startsAt', 'cubeIds', 'earlyCancellations'])
    .eachBatch(async (contracts) => {
      for (const contract of contracts) {
        const { startsAt, cubeIds, earlyCancellations } = contract.attributes
        const quarter = 'Q' + moment(startsAt).format('Q')
        const earlyCanceledIds = Object.keys(earlyCancellations || {})
          .filter(id => earlyCancellations[id] === true || earlyCancellations[id] <= today)
        const active = difference(cubeIds, earlyCanceledIds)
        if (active.length !== cubeIds.length - earlyCanceledIds.length) {
          consola.warn(contract.id)
        }
        quarterlyE[quarter] += (active.length)
        extendingContractCubeIds.push(...active)
      }
    }, { useMasterKey: true })
  console.log(quarterlyE, Object.values(quarterlyE).reduce((a, b) => a + b, 0))

  const allExtendingIds = await $query('Cube')
    .equalTo('order.company.objectId', 'FNFCxMgEEr')
    .equalTo('order.className', 'Contract')
    .equalTo('order.willExtend', true)
    .distinct('objectId', { useMasterKey: true })
  const extDiff = difference(allExtendingIds, extendingContractCubeIds)
  console.log('Extending kinetic cubes', allExtendingIds.length, 'Extending contract cubes', extendingContractCubeIds.length, 'Difference', extDiff)
})
