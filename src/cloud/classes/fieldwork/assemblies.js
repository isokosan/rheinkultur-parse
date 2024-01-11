Parse.Cloud.define('assembly-photos', async ({ params: { scope, className, objectId } }) => {
  const response = {}
  await $query('CubePhoto')
    .equalTo('scope', scope)
    .eachBatch((photos) => {
      for (const photo of photos) {
        const cubeId = photo.get('cubeId')
        if (!response[cubeId]) {
          response[cubeId] = []
        }
        response[cubeId].push(photo)
      }
    }, { useMasterKey: true })

  // append customService photos if special format
  if (className === 'SpecialFormat') {
    const specialFormat = await $getOrFail(className, objectId, 'customService')
    const customService = specialFormat.get('customService')
    const taskListIds = await $query('TaskList').equalTo('customService', customService).distinct('objectId', { useMasterKey: true })
    const scopes = taskListIds.map(id => 'special-format-TL-' + id)
    await $query('CubePhoto')
      .containedIn('scope', scopes)
      .eachBatch((photos) => {
        for (const photo of photos) {
          const cubeId = photo.get('cubeId')
          if (!response[cubeId]) {
            response[cubeId] = []
          }
          response[cubeId].push(photo)
        }
      }
      , { useMasterKey: true })
  }
  return response
}, { requireUser: true })
