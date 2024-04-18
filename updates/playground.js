require('./run')(async () => {
  const comments = await $query('Comment')
    .equalTo('itemClass', 'Contract')
    .startsWith('text', 'Der falsch angelegte CityCube')
    .find({ useMasterKey: true })
  for (const comment of comments) {
    const contract = await $getOrFail('Contract', comment.get('itemId'), 'cubeData')
    console.log(contract.get('no'))
    for (const cubeId of contract.get('cubeIds')) {
      if (!contract.get('cubeData')[cubeId]) {
        await Parse.Cloud.run('order-update-cube-data', { className: 'Contract', objectId: contract.id, cubeId }, { useMasterKey: true })
      }
    }
    console.log('---')
  }

  // const kinetic = await $getOrFail('Company', 'FNFCxMgEEr')
  // const contractBased = {
  //   contracts: 0,
  //   cubes: 0,
  //   lists: 0
  // }
  // const monthly = {
  //   M01: { contracts: 0, cubes: 0, pks: [] },
  //   M02: { contracts: 0, cubes: 0, pks: [] },
  //   M03: { contracts: 0, cubes: 0, pks: [] },
  //   M04: { contracts: 0, cubes: 0, pks: [] },
  //   M05: { contracts: 0, cubes: 0, pks: [] },
  //   M06: { contracts: 0, cubes: 0, pks: [] },
  //   M07: { contracts: 0, cubes: 0, pks: [] },
  //   M08: { contracts: 0, cubes: 0, pks: [] },
  //   M09: { contracts: 0, cubes: 0, pks: [] },
  //   M10: { contracts: 0, cubes: 0, pks: [] },
  //   M11: { contracts: 0, cubes: 0, pks: [] },
  //   M12: { contracts: 0, cubes: 0, pks: [] }
  // }
  // const quarterly = {
  //   Q1: { contracts: 0, cubes: 0, pks: [] },
  //   Q2: { contracts: 0, cubes: 0, pks: [] },
  //   Q3: { contracts: 0, cubes: 0, pks: [] },
  //   Q4: { contracts: 0, cubes: 0, pks: [] }
  // }
  // await $query('Contract')
  //   .equalTo('company', kinetic)
  //   .equalTo('status', 3)
  //   .select(['startsAt', 'cubeIds'])
  //   .eachBatch(async (contracts) => {
  //     for (const contract of contracts) {
  //       const { startsAt, cubeIds } = contract.attributes
  //       const pks = await $query('Cube').containedIn('objectId', cubeIds).distinct('pk', { useMasterKey: true })
  //       contractBased.contracts++
  //       contractBased.cubes += cubeIds.length
  //       contractBased.lists += pks.length
  //       const month = 'M' + moment(startsAt).add(6, 'months').format('MM')
  //       monthly[month].contracts++
  //       monthly[month].cubes += cubeIds.length
  //       monthly[month].pks.push(pks)
  //       const quarter = 'Q' + moment(startsAt).add(6, 'months').format('Q')
  //       quarterly[quarter].contracts++
  //       quarterly[quarter].cubes += cubeIds.length
  //       quarterly[quarter].pks.push(pks)
  //     }
  //   }, { useMasterKey: true })
  // // sum up pks in each monthly and quarterly into lists as a unique set count and delete pks key
  // for (const key in monthly) {
  //   monthly[key].lists = [...new Set(monthly[key].pks.flat())].length
  //   delete monthly[key].pks
  // }
  // for (const key in quarterly) {
  //   quarterly[key].lists = [...new Set(quarterly[key].pks.flat())].length
  //   delete quarterly[key].pks
  // }
  // console.log(monthly)
  // console.log(quarterly)
  // console.log('SUMMARY')
  // const totalListsToDealWith = {
  //   contractBased: contractBased.lists,
  //   monthly: Object.values(monthly).reduce((acc, cur) => acc + cur.lists, 0),
  //   quarterly: Object.values(quarterly).reduce((acc, cur) => acc + cur.lists, 0)
  // }
  // console.log('total lists', totalListsToDealWith)
  // const averageCubePerControlList = {
  //   contractBased: contractBased.cubes / contractBased.lists,
  //   monthly: Object.values(monthly).reduce((acc, cur) => acc + cur.cubes, 0) / totalListsToDealWith.monthly,
  //   quarterly: Object.values(quarterly).reduce((acc, cur) => acc + cur.cubes, 0) / totalListsToDealWith.quarterly
  // }
  // console.log('average cube per control list', averageCubePerControlList)
})
