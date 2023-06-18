const express = require('express')
const promBundle = require('express-prom-bundle')
const router = express.Router()

const prometheusMetrics = promBundle({
  buckets: [0.1, 0.5, 1, 1.5],
  includeMethod: true,
  includePath: true,
  customLabels: {
    app: null,
    type: null,
    version: null
  },
  transformLabels (labels, request) {
    // eslint-disable-next-line no-unused-expressions, no-sequences
    (labels.app = 'rheinkultur-wawi-parse'), (labels.type = 'rheinkultur-wawi-parse')
  },
  metricsPath: '/metrics',
  promClient: {
    collectDefaultMetrics: {}
  }
})

router.use('/metrcis', prometheusMetrics)
