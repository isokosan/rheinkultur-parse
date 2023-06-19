const { logger, expressLogger } = require('./logger')
const Adapter = require('./adapter')

module.exports = logger
module.exports.expressLogger = expressLogger
module.exports.adapter = new Adapter({ logger })
