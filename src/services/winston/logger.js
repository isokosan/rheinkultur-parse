const { createLogger, format, transports } = require('winston')
const expressWinston = require('express-winston')
const { inspect } = require('util')

const levels = {
  error: 0,
  warn: 1,
  success: 2,
  info: 3,
  http: 4,
  verbose: 5,
  debug: 6,
  silly: 7
}

const colors = {
  success: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'yellow',
  silly: 'white'
}

function getLogger () {
  if (DEVELOPMENT) {
    return createLogger({
      level: process.env.LOG_LEVEL || 'silly',
      levels,
      format: format.combine(
        format.errors({ stack: true }),
        format.colorize({ all: true, colors }),
        format.align(),
        format.splat(),
        format.printf((info) => {
          if (info.level.includes('error')) {
            return `${info.level}: ${info.stack || info.message || ''}`
          }
          return `${info.level}: ${info.message}`
        })
      ),
      transports: [new transports.Console()]
    })
  }
  return createLogger({
    level: process.env.LOG_LEVEL || 'http',
    levels,
    format: format.combine(format.errors({ stack: true }), format.timestamp(), format.json()),
    transports: [new transports.Console(), new transports.File({ filename: 'logs/combined.log' })]
  })
}

const logger = getLogger()
const expressLogger = expressWinston.logger({
  transports: [new transports.Console({ json: true, colorize: true })],
  levels,
  format: format.combine(format.timestamp(), format.json()),
  ignoreRoute: function (request, response) {
    if (request.url.startsWith('/healthz') || request.url.startsWith('/metrics')) {
      return true
    }

    return false
  },
  statusLevels: false,
  level: function (request, response) {
    if (response.statusCode >= 100) {
      return 'http'
    }
    if (response.statusCode >= 400) {
      return 'warn'
    }
    if (response.statusCode >= 500) {
      return 'error'
    }
  }
})

const consola = Object.keys(levels).reduce((acc, level) => {
  acc[level] = function (...messages) {
    logger[level](messages.map(msg => ['string', 'number'].includes(typeof msg) ? msg : inspect(msg, false, 3, true)).join(' '))
  }
  return acc
}, {})

module.exports = {
  logger,
  consola,
  expressLogger
}
