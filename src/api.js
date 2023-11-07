require('./globals')
const express = require('express')
const router = express.Router()

const Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)

const jwt = require('jsonwebtoken')
const handleErrorAsync = func => (req, res, next) => func(req, res, next).catch((error) => next(error))

router.use(async (req, res, next) => {
  const { authorization } = req.headers
  const [, token] = authorization?.split(' ') || []
  if (!token) {
    const error = new Error('A token is required for authentication')
    error.status = 403
    return next(error)
  }
  try {
    const { companyId } = jwt.verify(token, process.env.MASTER_KEY)
    req.company = $parsify('Company', companyId)
  } catch (error) {
    error.status = 401
    error.message = 'Invalid token'
    return next(error)
  }
  next()
})

router.get('/city-cubes', handleErrorAsync(async (req, res) => {
  const {
    // company,
    query: {
      center: c,
      radius: r,
      from,
      pagination
    }
  } = req
  const response = await Parse.Cloud.run('search', { c, r, from, pagination })
  console.log(response)
  res.send(response.results.map((result) => {
    delete result.state
    // delete result.stateId
    result.latitude = result.gp.latitude
    result.longitude = result.gp.longitude
    delete result.gp
    delete result.s
    return result
  }))
}))

module.exports = router
