const { round } = require('lodash')
const { v4: uuidv4 } = require('uuid')
const { exec } = require('child_process')

const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs))
const wait = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000))

const asyncExec = command => new Promise((resolve, reject) => {
  exec(command, (err, stdout, stderr) => err ? reject(err) : resolve())
})

const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  )

const batch = (payload, serverURL) => Promise.all(chunk(payload, 50)
  .map((requests) => {
    const url = `${serverURL || process.env.PARSE_SERVER_URL}/batch`
    return Parse.Cloud.httpRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-MASTER-Key': process.env.MASTER_KEY
      },
      body: { requests }
    })
  }))

const ensureUniqueField = async function (parseObject, field) {
  const exists = await $query(parseObject.className)
    .notEqualTo('objectId', parseObject.id || null)
    .equalTo(field, parseObject.get(field))
    .first({ useMasterKey: true })
  if (exists) {
    throw new Error(`${parseObject.className} with this ${field} already exists.`)
  }
}

const generateToken = () => `${uuidv4()}-${uuidv4()}`
const generatePassword = () => `${uuidv4()}`

const parseAsDigitString = function (num, digits = 4) {
  let string = `${num}`
  while (string.length < digits) {
    string = '0' + string
  }
  return string
}

const generateDarkColorHex = function () {
  let color = '#'
  for (let i = 0; i < 3; i++) { color += ('0' + Math.floor(Math.random() * Math.pow(16, 2) / 2).toString(16)).slice(-2) }
  return color
}

const round2 = amount => round(amount, 2)
const round5 = amount => round(amount, 5)

const priceString = (amount, decimalCount = 2, decimal = ',', thousands = '.', suffix = '') => {
  decimalCount = Math.abs(decimalCount)
  decimalCount = isNaN(decimalCount) ? 2 : decimalCount
  const negativeSign = amount < 0 ? '-' : ''
  const i = parseInt(amount = Math.abs(Number(amount) || 0).toFixed(decimalCount)).toString()
  const j = (i.length > 3) ? i.length % 3 : 0
  return negativeSign + (j ? i.substr(0, j) + thousands : '') + i.substr(j).replace(/(\d{3})(?=\d)/g, '$1' + thousands) + (decimalCount ? decimal + Math.abs(amount - i).toFixed(decimalCount).slice(2) : '') + suffix
}

const replaceLocalIp = function (url) {
  if (!url.includes('0.0.0.0')) {
    return url
  }
  const localIp = Object.values(require('os').networkInterfaces()).flat()
    .find(network => network?.address.startsWith('192.168.'))?.address || '0.0.0.0'
  return url.replace('0.0.0.0', localIp)
}

module.exports = {
  sleep,
  asyncExec,
  replaceLocalIp,
  wait,
  batch,
  chunk,
  ensureUniqueField,
  generateToken,
  generatePassword,
  parseAsDigitString,
  generateDarkColorHex,
  round2,
  round5,
  priceString
}
