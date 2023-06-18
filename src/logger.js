const winston = require('winston')
const expressWinston = require('express-winston')

const logger = expressWinston.logger({
  transports: [new winston.transports.Console({
    json: true,
    colorize: true
  })],
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  ignoreRoute: function (request, response) {
    if (request.url.startsWith('/healthz') || request.url.startsWith('/metrics')) {
      return true
    }

    return false
  },
  statusLevels: false,
  level: function (request, response) {
    let level = ''
    if (response.statusCode >= 100) {
      level = 'info'
    }
    if (response.statusCode >= 400) {
      level = 'warn'
    }
    if (response.statusCode >= 500) {
      level = 'error'
    }
    return level
  }
})

module.exports = logger
