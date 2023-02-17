const path = require('path')
const fs = require('fs').promises

const { createFakeObj } = require('./../utils')
const { fakeUser } = require('./../users')

let items = []
async function getCompanies () {
  if (!items.length) {
    items = await $query('Company')
      .include(['address', 'invoiceAddress'])
      .limit(1000)
      .find({ useMasterKey: true })
  }
  return items
}

const getCompanyByImportNo = async (importNo) => {
  importNo = parseInt(importNo)
  const addresses = await $query('Address').equalTo('importNo', importNo).include('company').find({ useMasterKey: true })
  if (!addresses.length) {
    return {}
  }
  const company = addresses[0].get('company')
  const invoiceAddress = addresses.find((address) => address.get('lex'))
  const address = addresses.find((address) => !address.get('lex')) || invoiceAddress
  return { company, address, invoiceAddress }
}

function landToCode (row) {
  if (row.land === 'Deutschland') {
    return 'DE'
  }
  if (row.land === 'Netherlands') {
    return 'NL'
  }
  throw new Error(`${row.importNo} ${row.name} - No land in address`)
}

async function getCustomers () {
  const customers = {}
  const processedCompanies = await fs.readFile(path.join(BASE_DIR, '/seed/data/processed-companies.json')).then(JSON.parse)
  for (const row of processedCompanies) {
    if (!row.name || !row.importNo) {
      continue
    }
    if ([100, 110, 114, 100, 149].includes(parseInt(row.importNo))) {
      continue
    }
    for (const key of Object.keys(row)) {
      if (key === '-') {
        delete row[key]
      }
    }
    row.name = row.name.trim()

    if (!customers[row.name]) {
      customers[row.name] = {
        name: row.name,
        importNo: row.importNo,
        addresses: []
      }
    }

    if (row.str) {
      const address = {
        importNo: parseInt(row.importNo),
        name: row.invoiceStr ? row.name : (row.invoiceName || row.name),
        supplement: row.supplement?.trim(),
        street: [row.str, row.hsnr].join(' '),
        zip: row.plz,
        city: row.ort,
        countryCode: landToCode(row),
        pbx: row.tel?.trim()
      }
      if (!row.invoiceStr) {
        address.invoiceAddress = true
        address.email = row.invoiceEmail?.trim()
      }
      customers[row.name].addresses.push(address)
    } else {
      if (!row.invoiceStr) {
        consola.error('NO ADDRESS')
        continue
      }
      customers[row.name].addresses.push({
        importNo: parseInt(row.importNo),
        name: row.invoiceName,
        invoiceAddress: true,
        supplement: row.invoiceSupplement?.trim(),
        street: [row.invoiceStr, row.invoiceHsnr].join(' '),
        zip: row.invoicePlz,
        city: row.invoiceOrt,
        countryCode: landToCode(row),
        email: row.invoiceEmail?.trim()
      })
    }

    if (row.str && row.invoiceStr) {
      customers[row.name].addresses.push({
        importNo: parseInt(row.importNo),
        name: row.invoiceName,
        invoiceAddress: true,
        supplement: row.invoiceSupplement?.trim(),
        street: [row.invoiceStr, row.invoiceHsnr].join(' '),
        zip: row.invoicePlz,
        city: row.invoiceOrt,
        countryCode: landToCode(row),
        email: row.invoiceEmail?.trim()
      })
    }
  }
  return customers
}

const seed = async function () {
  consola.info('seeding companies')
  items = []

  const ALDI = await $query('GradualPriceMap')
    .equalTo('code', 'ALDI')
    .first({ useMasterKey: true })
    .then(item => item.id)

  const CUSTOMER_SETTINGS = {
    'Kinetic Germany GmbH': {
      contractDefaults: {
        pricingModel: 'zero'
      }
    },

    // ALDI
    aldi: {
      tags: ['ALDI', 'Supermarkt'],
      contractDefaults: {
        billingCycle: 3,
        invoicingAt: 'end',
        pricingModel: 'gradual',
        gradualPriceMapId: ALDI
      }
    },

    // DISTRIBUTORS (6 + 1 (Marc Asriel))
    'Kulturplakatierung Berlin GmbH': {
      distributor: {
        pricingModel: 'commission',
        commission: 55
      }
    },
    'SD Gruppe': {
      distributor: {
        pricingModel: 'commission',
        commission: 55
      }
    },
    'Orange Mediaberatung': {
      distributor: {
        pricingModel: 'commission',
        commission: 61
      }
    },
    'Werberaum (Konzepthaus GmbH)': {
      distributor: {}
    },
    'awk Außenwerbung GmbH': {
      distributor: {
        pricingModel: 'commission',
        commission: 60
      }
    },
    'X-PO Design GmbH': {
      distributor: {
        pricingModel: 'commission',
        commission: 50
      }
    },

    // FIXED PRICE CUSTOMERS (2)
    'KLIMM Media GmbH & Co. KG': {
      contractDefaults: {
        billingCycle: 3,
        pricingModel: 'fixed',
        fixedPrice: 49
      }
    },
    'netto marketing / Team Wittstock': {
      tags: ['Supermarkt'],
      contractDefaults: {
        billingCycle: 3,
        pricingModel: 'fixed',
        fixedPriceMap: {
          KVZ: 30,
          MFG: 50
        }
      }
    },

    // AGENCIES (7)
    'Stadtkultur Stuttgart GmbH': {
      agency: {
        commissions: { 50: 'Anteil' },
        earningsVia: 'invoice'
      }
    },
    'Stadtkultur GmbH': { // Köln
      contractDefaults: {
        billingCycle: 3
      }
    },
    'Mammut Media': {
      agency: {
        commissions: { 30: 'Anteil' },
        earningsVia: 'invoice'
      }
    },
    'Zaunschilder.de': {
      agency: {
        commissions: { 25: 'Anteil' },
        earningsVia: 'invoice'
      }
    },
    'Südwind-Werbung': {
      agency: {
        commissions: { 25: 'Anteil' },
        earningsVia: 'invoice'
      }
    },
    'B.Boll, Verlag des Solinger Tageblattes GmbH & Co. KG': {
      agency: {
        commissions: { 50: 'Anteil' },
        earningsVia: 'credit-note'
      }
    },
    'Auprion GmbH': {
      // function as agency for Aldi, Lidl, Rewe
      agency: {
        commissions: { 50: 'Anteil' },
        earningsVia: 'credit-note'
      },
      // all others as customer
      contractDefaults: {
        billingCycle: 3
      }
    }
  }

  const customers = await getCustomers()
  for (const customer of Object.values(customers)) {
    if (customer.name === 'MA Lionsgroup BV') {
      continue
    }
    const key = customer.name.includes('ALDI') ? 'aldi' : customer.name
    if (CUSTOMER_SETTINGS[key]) {
      CUSTOMER_SETTINGS[key].transferred = true
    }
    const params = {
      importNo: parseInt(customer.importNo),
      name: customer.name,
      ...(CUSTOMER_SETTINGS[key] || {})
    }
    if (params.name.includes('ALDI SÜD')) {
      params.tags.push('ALDI SÜD')
    }
    let tagIds
    if (params.tags) {
      const tags = await $query('Tag').containedIn('name', params.tags).find({ useMasterKey: true })
      tagIds = tags.map(tag => tag.id)
    }
    await Parse.Cloud.run('company-create', {
      ...params,
      tagIds
    }, { useMasterKey: true })
  }

  await Parse.Cloud.run('company-create', {
    name: 'Stadtwerke Solingen',
    lessor: {
      code: 'SGSW',
      rate: 25,
      cycle: 3
    }
  }, { useMasterKey: true })

  await Parse.Cloud.run('company-create', {
    name: 'Technische Betriebe Solingen',
    lessor: {
      code: 'TBS',
      rate: 0,
      cycle: 3
    }
  }, { useMasterKey: true })

  await Parse.Cloud.run('company-create', {
    name: 'NetCologne',
    lessor: {
      code: 'NC',
      rate: 0,
      cycle: 3
    }
  }, { useMasterKey: true })

  // make X-PO a verpachter
  const xPo = await $query('Company').equalTo('name', 'X-PO Design GmbH').first({ useMasterKey: true })
  await Parse.Cloud.run('company-update-lessor', {
    id: xPo.id,
    isLessor: true,
    code: 'XPO',
    rate: 0,
    cycle: 3
  }, { useMasterKey: true })

  // seed telekom with lessor exceptions
  const kinetic = await $query('Company').equalTo('name', 'Kinetic Germany GmbH').first({ useMasterKey: true })
  await Parse.Cloud.run('company-create', {
    name: 'Telekom',
    lessor: {
      code: 'TLK',
      rate: 24,
      cycle: 3,
      exceptions: {
        'city:Berlin:BE': 63.5,
        [`companyId:${kinetic.id}`]: 0,
        // PDG Aachen
        'city:Aachen:NW': 0,
        'city:Alsdorf:NW': 0,
        'city:Baesweiler:NW': 0,
        'city:Eschweiler:NW': 0,
        'city:Herzogenrath:NW': 0,
        'city:Monschau:NW': 0,
        'city:Roetgen:NW': 0,
        'city:Simmerath:NW': 0,
        'city:Stolberg:NW': 0,
        'city:Würselen:NW': 0,
        // XPO
        'city:Nürnberg :BY': 0,
        'city:Fürth:BY': 0,
        'city:Würzburg :BY': 0,
        'city:Schweinfurt:BY': 0,
        'city:Schwabach:BY': 0,
        'city:Forchheim:BY': 0,
        'city:Zirndorf :BY': 0,
        'city:Burgthann:BY': 0,
        'city:Altdorf:BY': 0,
        'city:Haßfurt:BY': 0,
        'city:Bamberg:BY': 0,
        'city:Röthenbach:BY': 0,
        'city:Oberasbach:BY': 0,
        'city:Schweinfurt-Sennfeld:BY': 0,
        'city:Schweinfurt-Bergrheinfeld:BY': 0,
        'city:Erlangen:BY': 0,
        'city:Stein:BY': 0,
        'city:Kitzingen:BY': 0,
        'city:Ochsenfurt:BY': 0,
        'city:Bad Kissingen:BY': 0
      }
    }
  }, { useMasterKey: true })

  const telekom = await $query('Company').equalTo('name', 'Telekom').first({ useMasterKey: true })
  const marcAsriel = await Parse.Cloud.run('company-create', {
    importNo: parseInt(customers['MA Lionsgroup BV'].importNo),
    name: 'MA Lionsgroup BV',
    contractDefaults: { // Rest Deutschland
      billingCycle: 3,
      pricingModel: 'fixed',
      fixedPrice: 40
    },
    distributor: { // POTSDAM
      pricingModel: 'zero',
      periodicInvoicing: {
        total: 32500 / 4,
        lessorId: telekom.id,
        lessorRate: 24,
        extraCols: {
          Stadt: 'Potsdam Pachtanteil'
        }
      }
    }
  }, { useMasterKey: true })

  // seed marc asriel user and scouts
  await Promise.all([
    {
      email: 'marc@asriel.de',
      firstName: 'Marc',
      lastName: 'Asriel',
      accType: 'distributor',
      accRoles: ['manage-bookings', 'manage-scouts'],
      companyId: marcAsriel.id
    },
    {
      email: 'scout@asriel.de',
      firstName: 'MarcScout',
      lastName: 'Test',
      accType: 'scout',
      companyId: marcAsriel.id
    }
  ].map(opts => createFakeObj(Parse.User, 1, fakeUser, opts)))

  // seed non-trasferred customers
  for (const name of Object.keys(CUSTOMER_SETTINGS)) {
    if (CUSTOMER_SETTINGS[name].transferred) {
      continue
    }
    await Parse.Cloud.run('company-create', {
      name,
      ...CUSTOMER_SETTINGS[name]
    }, { useMasterKey: true })
  }

  consola.success('seeded companies')
}

const seedAddresses = async function () {
  consola.info('seeding addresses')
  const companies = await getCompanies()
  const customers = await getCustomers()
  for (const company of companies) {
    const name = company.get('name')
    for (const address of customers[name]?.addresses || []) {
      // if invoice address, check if lex address exists
      if (address.invoiceAddress) {
        delete address.invoiceAddress
        // check if address name exists on lexoffice
        const [contact] = await Parse.Cloud.run('lex-contacts', { name: address.name }, { useMasterKey: true })
        if (contact) {
          address.lex = contact
        } else {
          address.lex = await Parse.Cloud.run('lex-contact-create', {
            name: address.name,
            allowTaxFreeInvoices: address.countryCode !== 'DE' || undefined
          }, { useMasterKey: true })
          consola.warn('Created contact', address.name)
        }
      }
      const { id } = await Parse.Cloud.run('address-save', {
        companyId: company.id,
        ...address
      }, { useMasterKey: true }).catch(consola.error)
      !company.get('address') && company.set('address', $pointer('Address', id))
      address.lex && company.set('invoiceAddress', $pointer('Address', id))
    }
    await company.save(null, { useMasterKey: true })
  }
  consola.success('seeded addresses')
}

module.exports = {
  seed,
  seedAddresses,
  getCompanyByImportNo
}
