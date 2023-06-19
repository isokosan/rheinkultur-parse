const { createLogger, format, transports, addColors } = require('winston')
const expressWinston = require('express-winston')

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
  error: 'red',
  warn: 'orange',
  success: 'green',
  info: 'blue',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'yellow',
  silly: 'white'
}

function getLogger () {
  if (DEVELOPMENT) {
    return createLogger({
      level: process.env.LOG_LEVEL || 'info',
      levels,
      format: format.combine(
        format.errors({ stack: true }),
        format.colorize({ all: true }),
        format.align(),
        format.splat(),
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf((info) => {
          if (info.level.includes('error')) {
            return `[${info.timestamp}] ${info.level}: ${info.stack || info.message || ''}`
          }
          return `[${info.timestamp}] ${info.level}: ${info.message}`
        })
      ),
      transports: [new transports.Console()]
    })
  }
  return createLogger({
    level: process.env.LOG_LEVEL || 'info',
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
    return
  }
})

addColors(colors)
module.exports = {
  logger,
  expressLogger
}