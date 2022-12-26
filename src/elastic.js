const { Client } = require('@elastic/elasticsearch')
const client = new Client({
  node: process.env.ELASTIC_NODE,
  sniffOnStart: true,
  auth: process.env.ELASTIC_USER && process.env.ELASTIC_PASS
    ? {
      username: process.env.ELASTIC_USER,
      password: process.env.ELASTIC_PASS
    }
    : undefined
})

module.exports = client
module.exports.test = () => client.info()
