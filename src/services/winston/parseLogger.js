const { createLogger, format, transports } = require('winston')
function getLogger () {
  if (DEVELOPMENT) {
    return createLogger({
      level: process.env.LOG_LEVEL || 'info',
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
    format: format.combine(format.errors({ stack: true }), format.timestamp(), format.json()),
    transports: [new transports.Console(), new transports.File({ filename: 'logs/combined.log' })]
  })
}

module.exports = getLogger()
