const redis = require('@/redis')
const lex = require('@/lex')
const elastic = require('@/elastic')

Parse.Cloud.define('connection-tests', () => Promise.all([
  redis.test().catch(error => error.message),
  lex.test().catch(error => error.message),
  elastic.test().catch(error => error.message)
]), { requireMaster: true })
