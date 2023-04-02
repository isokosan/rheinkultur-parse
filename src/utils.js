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

const ensureUniqueField = async function (parseObject, ...fields) {
  const query = $query(parseObject.className)
    .notEqualTo('objectId', parseObject.id || null)
  for (const field of fields) {
    query.equalTo(field, parseObject.get(field))
  }
  if (await query.first({ useMasterKey: true })) {
    throw new Error(`${parseObject.className} mit ${fields.join(', ')} existiert bereits.`)
  }
}

const generateToken = () => `${uuidv4()}-${uuidv4()}`
const generatePassword = () => `${uuidv4()}`

const parseAsDigitString = function (num, digits = 4) {
  if (num === null || num === undefined) { return num }
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

function priceString (amount, decimalCount = 2, decimal = ',', thousands = '.', suffix = '') {
  decimalCount = Math.abs(decimalCount)
  decimalCount = isNaN(decimalCount) ? 2 : decimalCount
  const negativeSign = amount < 0 ? '-' : ''
  const i = parseInt(amount = Math.abs(Number(amount) || 0).toFixed(decimalCount)).toString()
  const j = (i.length > 3) ? i.length % 3 : 0
  return negativeSign + (j ? i.substr(0, j) + thousands : '') + i.substr(j).replace(/(\d{3})(?=\d)/g, '$1' + thousands) + (decimalCount ? decimal + Math.abs(amount - i).toFixed(decimalCount).slice(2) : '') + suffix
}

function durationString (end, start) {
  const isInt = value => parseInt(value) === value
  const endMoment = moment(end).add(1, 'days')
  const months = Math.abs(endMoment.diff(start, 'months', true))
  if (isInt(months)) {
    if (months === 0) { return '0 Tage' }
    return months === 1 ? `${months} Monat` : `${months} Monate`
  }
  const weeks = Math.abs(endMoment.diff(start, 'weeks', true))
  if (isInt(weeks)) {
    return weeks === 1 ? `${weeks} Woche` : `${weeks} Wochen`
  }
  const days = Math.abs(endMoment.diff(start, 'days'))
  return days === 1 ? `${days} Tag` : `${days} Tage`
}

function dateString (date) {
  if (!date) { return }
  return moment(date).format('DD.MM.YYYY')
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
  priceString,
  dateString,
  durationString
}
