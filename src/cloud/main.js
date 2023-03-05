const { version } = require('@/../package.json')
const { getCountries } = require('@/services/lex')

const {
  ACC_TYPES: accTypes,
  BOOKING_STATUSES: bookingStatuses,
  CONTRACT_STATUSES: contractStatuses,
  CUBE_STATUSES: cubeStatuses,
  INVOICE_STATUSES: invoiceStatuses,
  PAYMENT_TYPES: paymentTypes,
  BILLING_CYCLES: billingCycles,
  CREDIT_NOTE_STATUSES: creditNoteStatuses,
  PRINT_PACKAGE_TYPES: printPackageTypes,
  PRINT_PACKAGE_FACES: printPackageFaces,
  PRINT_PACKAGE_FILES: printPackageFiles,
  INTEREST_RATES: interestRates,
  DEPARTURE_LIST_STATUSES: departureListStatuses
} = require('@/schema/enums')

const {
  classes: {
    users: { fetchUsers },
    companies: { fetchCompanies },
    mediae: { fetchMediae },
    'print-packages': { fetchPrintPackages },
    states: { fetchStates },
    tags: { fetchTags },
    'housing-types': { fetchHousingTypes },
    'gradual-price-maps': { fetchGradualPriceMaps }
  }
} = require('require-dir')('./', {
  recurse: true
})

process.env.SEED && require('@/seed/scouting')

Parse.Cloud.define('init', async ({ params: { keys = [] }, user }) => {
  if (!user) { keys = ['states'] }
  const dictionary = {
    version,
    development: DEVELOPMENT,
    today: await $today(),
    users: !keys.length || keys.includes('users')
      ? await fetchUsers() // .then(items => items.map(item => item.toJSON()))
      : undefined,
    companies: !keys.length || keys.includes('companies')
      ? await fetchCompanies() // .then(items => items.map(item => item.toJSON()))
      : undefined,
    mediae: !keys.length || keys.includes('mediae')
      ? await fetchMediae() // .then(items => items.map(item => item.toJSON()))
      : undefined,
    printPackages: !keys.length || keys.includes('printPackages')
      ? await fetchPrintPackages()
      : undefined,
    housingTypes: !keys.length || keys.includes('housingTypes')
      ? await fetchHousingTypes()
      : undefined,
    states: !keys.length || keys.includes('states')
      ? await fetchStates()
      : undefined,
    countries: !keys.length || keys.includes('countries')
      ? await getCountries()
      : undefined,
    tags: !keys.length || keys.includes('tags')
      ? await fetchTags() // .then(items => items.map(item => item.toJSON()))
      : undefined,
    gradualPriceMaps: !keys.length || keys.includes('gradualPriceMaps')
      ? await fetchGradualPriceMaps() // .then(items => items.map(item => item.toJSON()))
      : undefined
  }
  return dictionary
})

Parse.Cloud.define('enums', () => ({
  version,
  accTypes,
  bookingStatuses,
  cubeStatuses,
  contractStatuses,
  invoiceStatuses,
  creditNoteStatuses,
  paymentTypes,
  billingCycles,
  printPackageTypes,
  printPackageFaces,
  printPackageFiles,
  interestRates,
  departureListStatuses
}), { requireUser: true })

// temporary solution to PLZ's without redis
global.$noMarketingRights = {}
async function syncNoMarketingRights () {
  const plzs = await $query('PLZ').equalTo('nMR', true).distinct('objectId', { useMasterKey: true })
  for (const plz of plzs) {
    $noMarketingRights[plz] = true
  }
  consola.success('stored no marketing rights in memory')
}
syncNoMarketingRights()
