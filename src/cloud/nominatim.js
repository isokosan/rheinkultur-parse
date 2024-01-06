Parse.Cloud.define('nominatim', async ({ params: { lat, lon } }) => {
  const { data } = await Parse.Cloud.httpRequest({
    url: process.env.NOMINATIM_REVERSE_API,
    params: {
      format: 'jsonv2',
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      'accept-language': 'de-DE'
    }
  })
  return data
})

Parse.Cloud.define('nominatim-search', async ({ params: { query } }) => {
  const { data } = await Parse.Cloud.httpRequest({
    url: process.env.NOMINATIM_API + '/search',
    params: {
      format: 'jsonv2',
      q: query
    }
  })
  return data
})
