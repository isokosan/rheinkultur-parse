const express = require('express')
const router = express.Router()
const handleErrorAsync = func => (req, res, next) => func(req, res, next).catch((error) => next(error))

router.get('/', handleErrorAsync((req, res) => {
  return res.send('ok')
}))

module.exports = router
