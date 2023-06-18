const LogAdapter = require('./LogAdapter')
const winstonLogger = require('./parseLogger')

module.exports = new LogAdapter({ logger: winstonLogger })
