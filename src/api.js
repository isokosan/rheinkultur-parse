require('./globals')
const express = require('express')
const router = express.Router()

const Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)

const jwt = require('jsonwebtoken')
const handleErrorAsync = func => (req, res, next) => func(req, res, next).catch((error) => res.status(500).send({ error: error.message }))

router.use(handleErrorAsync(async (req, res, next) => {
  const { authorization } = req.headers
  const [, token] = authorization?.split(' ') || []
  if (!token) {
    const error = new Error('A token is required for authentication')
    error.status = 403
    throw error
  }
  try {
    const { companyId } = jwt.verify(token, process.env.MASTER_KEY)
    req.company = $parsify('Company', companyId)
  } catch (error) {
    error.status = 401
    error.message = 'Invalid token'
    throw error
  }
  next()
}))

let states
router.get('/city-cubes', handleErrorAsync(async (req, res) => {
  if (!states) {
    const { fetchStates } = require('./cloud/classes/states')
    states = await fetchStates()
  }
  const {
    // company,
    query: {
      id,
      center: c,
      radius: r,
      from,
      pagination
    }
  } = req

  if (c || r) {
    if (!c || !r) {
      throw new Error('Please specify both the center and radius parameters for georadius search')
    }
    if (from || pagination) {
      throw new Error('Please leave from and pagination empty when using georadius search')
    }
  }

  if (id) {
    if (c || r || from || pagination) {
      throw new Error('Please leave all other parameters empty when using id search')
    }
  }

  if (pagination > 5000) {
    throw new Error('Pagination cannot be greater than 5000')
  }

  const { results } = await Parse.Cloud.run(
    'search',
    id
      ? { id }
      : { c, r, from, pagination }
  )

  const mediaMap = {
    KVZ: 'Regular Size',
    MFG: 'Premium Size',
    0: 'Unbekannt'
  }

  const resultMapper = (result) => {
    result.id = result.objectId
    delete result.objectId
    result.state = states[result.stateId]?.name
    delete result.stateId
    result.latitude = result.gp.latitude
    result.longitude = result.gp.longitude
    delete result.gp
    result.available = result.s < 5
    delete result.s
    let media = mediaMap[result.media || 0]
    consola.info(result.media, result.vAt)
    if (result.media && !result.vAt) {
      media += ' (Unbestätigt)'
    }
    delete result.vAt
    result.media = media
    return result
  }

  // return single item if found
  if (id) {
    const result = results.find(result => result.objectId === id)
    if (!result) {
      throw new Error('No result found')
    }
    return res.send(resultMapper(result))
  }
  res.send(results.map(resultMapper))
}))

module.exports = router
