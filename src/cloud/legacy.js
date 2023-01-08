Parse.Cloud.define('legacy-scouted-cube', async ({ params: { objectId } }) => {
  if (!objectId.startsWith('TLK-')) {
    throw new Error('Can only check Telekom cubes')
  }
  const cleanedKvzIds = objectId.replace(/^TLK-/, '')
  const cubesObj = await Parse.Cloud.httpRequest({
    url: process.env.SCOUT_APP_SERVER_URL + '/classes/Cubes/',
    method: 'GET',
    params: {
      limit: 1,
      where: JSON.stringify({ cleanedKvzIds })
    },
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.SCOUT_APP_APP_ID,
      'X-Parse-Master-Key': process.env.SCOUT_APP_MASTER_KEY
    }
  }).then(res => res.data.results[0])
  if (!cubesObj) {
    return []
  }
  const cubeResults = await Parse.Cloud.httpRequest({
    url: process.env.SCOUT_APP_SERVER_URL + '/classes/CubeResult/',
    method: 'GET',
    params: {
      where: JSON.stringify({ cubeId: cubesObj.objectId })
    },
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.SCOUT_APP_APP_ID,
      'X-Parse-Master-Key': process.env.SCOUT_APP_MASTER_KEY
    }
  }).then(res => res.data.results)
  const imageIds = cubeResults.map(r => r.images.map(({ objectId }) => objectId)).flat()
  return Parse.Cloud.httpRequest({
    url: process.env.SCOUT_APP_SERVER_URL + '/classes/FileUpload/',
    method: 'GET',
    params: {
      where: JSON.stringify({ objectId: { $in: imageIds } })
    },
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.SCOUT_APP_APP_ID,
      'X-Parse-Master-Key': process.env.SCOUT_APP_MASTER_KEY
    }
  }).then(res => res.data.results.map((image) => {
    image.cleanedKvzIds = cubesObj.cleanedKvzIds
    return image
  }))
})

Parse.Cloud.define('legacy-address-search', ({ params: { str, hsnr, plz, ort } }) => {
  const where = {}
  if (str) { where.str = { $regex: `^${str}` } }
  if (hsnr) { where.hsnr = hsnr }
  if (plz) { where.plz = plz }
  if (ort) { where.ort = ort }
  if (!Object.keys(where).length) {
    return []
  }
  return Parse.Cloud.httpRequest({
    url: process.env.SCOUT_APP_SERVER_URL + '/classes/AddressPhoto/',
    method: 'GET',
    params: {
      where: JSON.stringify(where),
      include: ['file'],
      limit: 20
    },
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.SCOUT_APP_APP_ID,
      'X-Parse-Master-Key': process.env.SCOUT_APP_MASTER_KEY
    }
  }).then(res => res.data.results)
})
