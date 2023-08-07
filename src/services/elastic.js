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
  // maxRetries: 3,
  // requestTimeout: 30000
})

async function test () {
  const index = 'rheinkultur-test'
  // Check if the 'test' index exists
  const indexExists = await client.indices.exists({ index })

  // If the index does not exist, create it
  !indexExists && await client.indices.create({ index })

  // // Add a document to the index
  await client.index({
    index,
    id: 'test-document',
    body: {
      date: new Date().toISOString()
    }
  })

  await new Promise(resolve => setTimeout(resolve, 1000))

  // Query the index
  const { hits } = await client.search({
    index,
    body: { query: { ids: { values: ['test-document'] } } }
  })
  return hits.hits.length === 1 && hits.hits[0]._id === 'test-document'
}

module.exports = client
module.exports.getVersion = () => client.info().then(({ version: { number } }) => number)
module.exports.test = test
