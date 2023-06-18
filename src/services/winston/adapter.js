class LogAdapter {
  constructor (options) {
    this.logger = options.logger
  }

  /**
   * log
   * @param {String} level
   * @param {String} message
   * @param {Object} metadata
   */
  log (level, message, meta) {
    this.logger.log(level, message, meta)
  }

  query (options = {}, callback = () => {}) {
    const level = options.level || 'info'

    const queryOptions = {
      from: options.from ?? Date.now() - 24 * 60 * 60 * 1000,
      until: options.until ?? new Date(),
      rows: options.size ?? 100,
      start: options.start ?? 0,
      order: options.order || 'desc'
    }

    return new Promise((resolve, reject) => {
      this.logger.query(queryOptions, (error, result) => {
        if (error) {
          callback(error)
          return reject(error)
        }

        if (level === 'error') {
          const errors = result.file?.filter((item) => item.level === 'error') ?? []
          callback(errors)
          resolve(errors)
        } else {
          const info = result.file?.filter((item) => item.level !== 'error') ?? []
          callback(info)
          resolve(info)
        }
      })
    })
  }
}

module.exports = LogAdapter
