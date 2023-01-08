// const redis = require('@/services/redis')
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

process.env.SEED && require('@/seed')

Parse.Cloud.define('init', async ({ params: { keys = [], force = true } }) => {
  // if (!force) {
  //   const cached = await redis.get('dictionary')
  //   if (cached) {
  //     consola.success('cached dictionary')
  //     return JSON.parse(cached)
  //   }
  // }
  const dictionary = {
    version: require('@/../package.json').version,
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
  // await redis.setex('dictionary', 60, JSON.stringify(dictionary))
  return dictionary
}, { requireUser: true })

Parse.Cloud.define('enums', () => ({
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
