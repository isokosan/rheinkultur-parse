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
  await $query('Cube')
    .notEqualTo('order.controlAt', null)
    .find({ useMasterKey: true })
    .then((cubes) => {
      console.log(`Found ${cubes.length} cubes with controlAt`)
      cubes.forEach((cube) => {
        console.log(cube.id, cube.get('order'))
      })
    })
})
