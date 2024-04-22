require('./run')(async () => {
  let i = 0
  await $query('Control')
    .equalTo('orderKeys', null)
    .each((control) => {
      i++
      const orderKeys = [...new Set(Object.values(control.get('cubeOrderKeys')))]
      return control.save({ orderKeys }, { useMasterKey: true })
    }, { useMasterKey: true })
  console.log(`Updated ${i} controls`)

  // run sync cube statuses after this update

  // then check the cubes with controlAt
  // await $query('Cube')
  //   .notEqualTo('order.controlAt', null)
  //   .find({ useMasterKey: true })
  //   .then((cubes) => {
  //     console.log(`Found ${cubes.length} cubes with controlAt`)
  //     cubes.forEach((cube) => {
  //       console.log(cube.id, cube.get('order'))
  //     })
  //   })

  // after which we want to create our periodic example controls
  // for (const quarter of ['Q2', 'Q3', 'Q4']) {
  //   const date = moment().quarter(quarter.slice(1)).startOf('quarter').format('YYYY-MM-DD')
  //   const dueDate = moment(date).endOf('quarter').format('YYYY-MM-DD')
  //   const untilDate = moment(dueDate).add(1, 'month').format('YYYY-MM-DD')
  //   const startedBefore = moment(date).subtract(6, 'months').format('YYYY-MM-DD')
  //   const lastControlBefore = 12 // 12 months before start date
  //   const lastControlAt = moment(date).subtract(lastControlBefore, 'months').format('YYYY-MM-DD')
  //   const orderType = 'Contract'
  //   console.log({ orderType, date, dueDate, startedBefore, lastControlBefore, lastControlAt, untilDate })
  //   // await Parse.Cloud.run('control-create', {})
  // }
})
