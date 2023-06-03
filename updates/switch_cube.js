require('dotenv').config()
global.Parse = require('parse/node')
Parse.serverURL = process.env.PRODUCTION_SERVER_URL
// Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

async function switchCube (contractNo, fromId, toId) {
  const contract = await $query('Contract').equalTo('no', contractNo).first({ useMasterKey: true })
  if (!contract) { throw new Error('Contract not found') }
  const cubeIds = contract.get('cubeIds')
  if (!cubeIds.includes(fromId)) { throw new Error('Cube not in contract') }
  // TODO: check monthlyMedia etc...
  const index = cubeIds.indexOf(fromId)
  cubeIds[index] = toId
  contract.set({ cubeIds })
  await contract.save(null, { useMasterKey: true, context: { setCubeStatuses: true, recalculatePlannedInvoices: true } })
  const comment = `Der falsch angelegte CityCube ${fromId} wurde durch CityCube ${toId} ersetzt.`
  await Parse.Cloud.run('comment-create', {
    itemId: contract.id,
    itemClass: 'Contract',
    text: comment
  }, { useMasterKey: true })
}

switchCube('V20-0655', 'TLK-73073A32', 'TLK-73073A532').then(consola.success)
