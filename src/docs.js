const { sum } = require('lodash')
const { docs, drive } = require('@/services/googleapis')
const redis = require('@/services/redis')
const { priceString } = require('@/utils')
const { getCubeSummaries } = require('@/shared')
const { PRINT_PACKAGE_TYPES, PRINT_PACKAGE_FACES } = require('@/schema/enums')

const originFileId = '1Nq6R5_OCE-YE2DqcR178pv3WrtXtPuEgg4M3Lx1NfM8'

const freshCopy = name => drive.files.copy({ fileId: originFileId })
  .then(res => drive.files.update({ fileId: res.data.id, requestBody: { name } }))
  .then(res => res.data.id)

const getCountryText = value => value === 'DE' ? '' : redis.hget('countries', value)

async function getReplaceTextRequests (contract) {
  const company = contract.get('company')
  const billingCycle = contract.get('billingCycle')

  const productionTotal = Object.keys(contract.get('production')?.get('prices') || {}).length
    ? priceString(sum(Object.values(contract.get('production').get('prices'))))
    : '-'

  const extrasTotal = Object.keys(contract.get('production')?.get('extrasWI') || {}).length
    ? priceString(sum(Object.values(contract.get('production').get('extrasWI'))))
    : '-'

  const companyPerson = contract.get('companyPerson')
  let contactPersonName = ''
  if (companyPerson) {
    const { prefix, firstName, lastName } = companyPerson.attributes
    contactPersonName = [prefix, firstName, lastName].filter(x => x).join(' ')
  }

  const companyAddress = [
    contract.get('address').get('name'),
    contactPersonName,
    contract.get('address').get('supplement'),
    contract.get('address').get('street'),
    `${contract.get('address').get('zip')} ${contract.get('address').get('city')}` + await getCountryText(contract.get('address').get('countryCode'))
  ].filter(x => x).join('\n')

  const invoiceAddress = !contract.get('invoiceAddress')
    ? '(X) entspricht der Adresse Mieter'
    : [
      contract.get('invoiceAddress').get('name'),
      contract.get('invoiceAddress').get('supplement'),
      contract.get('invoiceAddress').get('street'),
      `${contract.get('invoiceAddress').get('zip')} ${contract.get('invoiceAddress').get('city')}` + await getCountryText(contract.get('invoiceAddress').get('countryCode'))
    ].filter(x => x).join('\n')

  let autoExtends = 'verlängert sich nicht automatisch'
  let autoExtendDetails = '.'
  if (contract.get('autoExtendsAt')) {
    autoExtends = 'verlängert sich automatisch'
    autoExtendDetails = ` um jeweils weitere ${contract.get('autoExtendsBy') || 12} Monate, wenn er nicht ${contract.get('noticePeriod')} Monate vor Vertragsablauf schriftlich gekündigt wird.`
  }

  const replacements = {
    companyName: company.get('name') || '',
    COMPANY_NAME: (company.get('name') || '').toUpperCase(),
    companyAddress,
    invoiceAddress,
    companyTaxNo: company.get('taxNo') || '',
    contractNo: contract.get('no'),
    motiv: contract.get('motive') ? 'Motiv: ' : '',
    motive: contract.get('motive') ? `${contract.get('motive')}\n` : '',
    monthlyMediaTotal: contract.get('pricingModel') === 'gradual'
      ? 'Staffelkonditionen'
      : priceString(sum(Object.values(contract.get('monthlyMedia')))),
    productionTotal,
    extrasTotal,
    startsAt: moment(contract.get('startsAt')).format('DD.MM.YYYY'),
    initialDuration: contract.get('initialDuration'),
    autoExtends,
    autoExtendDetails,
    today: moment(await $today()).format('DD.MM.YYYY'),
    m: billingCycle === 1 ? 'X' : '  ',
    v: billingCycle === 3 ? 'X' : '  ',
    h: billingCycle === 6 ? 'X' : '  ',
    j: billingCycle === 12 ? 'X' : '  ',
    contactPersonSig: contactPersonName ? `(${contactPersonName})` : ''
  }
  const requests = []
  for (const key of Object.keys(replacements)) {
    requests.push({
      replaceAllText: {
        replaceText: `${replacements[key] || ''}`,
        containsText: { text: `{${key}}`, matchCase: true }
      }
    })
  }
  return requests
}

const getCubeAddress = ({ str, hsnr, plz, ort }) => [str, hsnr + ',', plz, ort].join(' ')

async function getCubesListReplaceRequest (contract) {
  const cubes = await getCubeSummaries(contract.get('cubeIds'))
  const production = contract.get('production')
  let cubesListText = ''
  let i = 1
  for (const cube of Object.values(cubes)) {
    const address = getCubeAddress(cube)
    let productionPrice
    let extraPrice
    let productionMonthlyPrice
    let text = `\n${i}. Standort: ${address}`
    text += `\nGehäusetyp: ${cube.ht ? cube.ht.code : 'Unbekkant'}`
    text += `\nCityCube ID: ${cube.objectId}`
    if (production) {
      const printPackage = production.get('printPackages')[cube.objectId]
      const printFaces = []
      for (const face of Object.keys(printPackage.faces)) {
        if (face === 'side') {
          printFaces.push(printPackage.faces[face] === 1 ? 'Eine Seite' : 'Beide Seite')
          continue
        }
        printFaces.push(PRINT_PACKAGE_FACES[face])
      }
      productionPrice = production.get('prices')?.[cube.objectId]
      extraPrice = production.get('extrasWI')?.[cube.objectId]
      productionMonthlyPrice = production.get('monthlies')?.[cube.objectId]
      text += `\nBelegung: ${printFaces.join(' + ')}`
      text += `\nMaterial: ${PRINT_PACKAGE_TYPES[printPackage.type]} Nr.: ${printPackage.no}`
    }
    const monthlyPriceLine = contract.get('pricingModel') === 'gradual'
      ? 'Monatsmiete: Staffelkonditionen'
      : `Monatsmiete: ${priceString(contract.get('monthlyMedia')[cube.objectId])} EUR`
    text += '\n\n' + monthlyPriceLine
    if (productionPrice) {
      text += `\nProduktions- und Montagekosten: ${priceString(productionPrice)} EUR`
    }
    if (extraPrice) {
      text += `\nSonderkosten: ${priceString(extraPrice)} EUR`
    }
    if (productionMonthlyPrice) {
      text += `\n(Monatlich: ${priceString(productionMonthlyPrice)} EUR)`
    }
    text += '\n'
    cubesListText += text
    i++
  }
  return {
    replaceAllText: {
      replaceText: cubesListText,
      containsText: { text: '{cubesList}', matchCase: true }
    }
  }
}

const generateContract = async (contract) => {
  await contract.fetchWithInclude(['company', 'address', 'invoiceAddress', 'companyPerson', 'production'], { useMasterKey: true })
  const name = `${contract.get('status') < 2 ? 'Angebot' : 'Vertrag'} ${contract.get('no')}`
  const fileId = await freshCopy(name)
  // Figured it out, you can only use G Suite domains. It is a bummer but in order to share file permission exclusively with a domain you need to have a G Suite account and verify that you own that domain - the domain needs to be linked with your G Suite account.
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'writer',
      type: 'anyone'
      // allowFileDiscovery: true,
      // domain: 'rheinkultur-medien.de'
    }
  })
  const { data } = await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests: [
        ...await getReplaceTextRequests(contract),
        await getCubesListReplaceRequest(contract),
        {
          updateParagraphStyle: {
            paragraphStyle: {
              keepLinesTogether: true,
              keepWithNext: true
            },
            fields: 'keepLinesTogether, keepWithNext',
            range: {
              segmentId: '',
              startIndex: 1,
              endIndex: 1000
            }
          }
        }
      ]
    }
  })
  return data.documentId
}

// const cleanup = async () => {
//   const fileIds = await drive.files.list({
//     pageSize: 100,
//     fields: 'nextPageToken, files(id, name)'
//   }).then(res => res.data.files.map(file => file.id))
//   return Promise.all(fileIds
//     .filter(id => id !== originFileId)
//     .map(fileId => drive.files.delete({ fileId }))
//   )
// }
// cleanup()

module.exports = {
  generateContract
}