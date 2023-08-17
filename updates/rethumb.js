async function rethumb () {
  let p = 0
  const startOfToday = moment().startOf('day').toDate()
  const saveOptions = { useMasterKey: true, context: { regenerateThumb: true, regenerateSize1000: true } }
  await $query('CubePhoto')
    .greaterThan('createdAt', startOfToday)
    .each(async (photo) => {
      await photo.save(null, saveOptions)
      p++
      console.log(photo.get('cubeId'))
    }, { useMasterKey: true })
  console.log({ p })
}

require('./run')(() => rethumb())
