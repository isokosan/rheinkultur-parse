const redis = require('@/services/redis')
const { chunk } = require('@/utils')
const { promisify } = require('node:util')
const request = promisify(require('request'))

const seed = async function () {
  await (new Parse.Schema('PLZ')).purge()
  await redis.del('no-marketing-rights')
  const blacklists = [...new Set(require('./blacklist.json').map(({ PLZ: plz }) => plz))]
    .map((plz) => {
      while (plz.length < 5) {
        plz = '0' + plz
      }
      return plz
    })

  const states = {}
  for (const state of await $query('State').find({ useMasterKey: true })) {
    states[state.get('name')] = state.toPointer()
  }
  const all = require('./plzs.json').map(({ plz, bundesland, ort }) => ({
    method: 'POST',
    path: '/parse/classes/PLZ/',
    body: {
      objectId: plz,
      ort,
      state: states[bundesland],
      nMR: blacklists.includes(plz) ? true : undefined
    }
  }))
  for (const requests of chunk(all, 50)) {
    await request({
      url: `${process.env.PUBLIC_SERVER_URL}/batch`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-MASTER-Key': process.env.MASTER_KEY
      },
      json: true,
      body: { requests }
    })
  }
  consola.success('PLZs seeded')
  return redis.scard('no-marketing-rights')
}

module.exports = {
  seed
}
