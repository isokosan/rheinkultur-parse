const redis = require('./redis')
const elastic = require('./elastic')
const lex = require('./lex')
module.exports = async (req, res) => {
  const response = await Promise.all([
    redis.test(),
    elastic.test(),
    lex.test()
  ])
  return res.send(response)
}
