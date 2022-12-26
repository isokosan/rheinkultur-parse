const redis = require('@/redis')
const lex = require('@/lex')
const elastic = require('@/elastic')

Parse.Cloud.define('connection-tests', () => Promise.all([
  redis.test(),
  lex.ensureSubscriptions(),
  elastic.test()
]), { requireMaster: true })
