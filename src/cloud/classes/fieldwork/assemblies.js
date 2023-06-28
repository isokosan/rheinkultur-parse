// TODO: move to assemblies.js
Parse.Cloud.define('assembly-photos', async ({ params: { scope } }) => {
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
  return response
}, { requireUser: true })
