const { promisify } = require('node:util')
const request = promisify(require('request'))

const seed = async () => {
  const states = [
    {
      name: 'Sachsen',
      objectId: 'SN'
    },
    {
      name: 'Bayern',
      objectId: 'BY'
    },
    {
      name: 'Niedersachsen',
      objectId: 'NI'
    },
    {
      name: 'Nordrhein-Westfalen',
      objectId: 'NW'
    },
    {
      name: 'Sachsen-Anhalt',
      objectId: 'ST'
    },
    {
      name: 'Hessen',
      objectId: 'HE'
    },
    {
      name: 'Berlin',
      objectId: 'BE'
    },
    {
      name: 'Baden-Württemberg',
      objectId: 'BW'
    },
    {
      name: 'Schleswig-Holstein',
      objectId: 'SH'
    },
    {
      name: 'Mecklenburg-Vorpommern',
      objectId: 'MV'
    },
    {
      name: 'Brandenburg',
      objectId: 'BB'
    },
    {
      name: 'Rheinland-Pfalz',
      objectId: 'RP'
    },
    {
      name: 'Thüringen',
      objectId: 'TH'
    },
    {
      name: 'Hamburg',
      objectId: 'HH'
    },
    {
      name: 'Saarland',
      objectId: 'SL'
    },
    {
      name: 'Bremen',
      objectId: 'HB'
    }
  ]
  const requests = states.map(body => ({
    method: 'POST',
    path: '/parse/classes/State/',
    body
  }))
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
  consola.success('States seeded')
}

module.exports = { seed }
