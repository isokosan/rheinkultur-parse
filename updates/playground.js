require('./run')(async () => {
  let i = 0
  let t = 0
  await $query('Cube')
    .contains('objectId', '*')
    // .count({ useMasterKey: true })
    // .then(console.log)
    .each(async (cube) => {
      // check if cube is in task list and remove
      await $query('TaskList').equalTo('cubeIds', cube.id).each(async (taskList) => {
        const cubeIds = taskList.get('cubeIds').filter(id => id !== cube.id)
        taskList.set('cubeIds', cubeIds)
        await taskList.save(null, { useMasterKey: true })
        t++
      }, { useMasterKey: true })
      await cube.destroy({ useMasterKey: true })
      i++
    }, { useMasterKey: true })
  console.log({ i, t })
})
