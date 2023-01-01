const { Client } = require('@googlemaps/google-maps-services-js')
const client = new Client({})
const key = process.env.GOOGLE_MAPS_API_KEY

const getPlacesPredictions = async (input) => {
  const { data: { predictions } } = await client.placeAutocomplete({
    params: { key, input, language: 'de', region: 'de' }
  })
  return predictions
}

const getPlaceById = async (place_id) => {
  const { data: { result: place } } = await client.placeDetails({
    params: { key, place_id }
  })
  return place
}

module.exports = client
module.exports.getPlacesPredictions = getPlacesPredictions
module.exports.getPlaceById = getPlaceById
module.exports.test = async () => {
  const response = await getPlacesPredictions('Test Street')
  return Boolean(response.length)
}
