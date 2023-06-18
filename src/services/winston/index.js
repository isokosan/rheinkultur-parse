const Adapter = require('./adapter')
const logger = require('./logger')

module.exports = logger
module.exports.adapter = new Adapter({ logger })
