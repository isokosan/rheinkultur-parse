// TODO: move to assemblies.js
Parse.Cloud.define('assembly-photos', async ({ params: { assemblyKey } }) => {
  const response = {}
  await $query('CubePhoto')
    .equalTo('assemblyKey', assemblyKey)
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
