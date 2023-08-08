const { version } = require('@/../package.json')
const { getCountries } = require('@/services/lex')

const {
  ACC_TYPES: accTypes,
  BOOKING_STATUSES: bookingStatuses,
  BOOKING_REQUEST_TYPES: bookingRequestTypes,
  BOOKING_REQUEST_STATUSES: bookingRequestStatuses,
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
  TASK_LIST_STATUSES: taskListStatuses,
  FIELDWORK_STATUSES: fieldworkStatuses
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

require('@/jobs')
DEVELOPMENT && require('@/queues')
DEVELOPMENT && require('@/development')
process.env.SEED && require('@/seed/fieldwork')

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
      : undefined,
    systemStatus: await Parse.Config.get().then(config => config.get('systemStatus'))
  }
  return dictionary
})

Parse.Cloud.define('enums', () => ({
  version,
  accTypes,
  bookingStatuses,
  bookingRequestTypes,
  bookingRequestStatuses,
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
  taskListStatuses,
  fieldworkStatuses
}), { requireUser: true })

// TOLATER: Save this in database and make editable
global.$PDGA = {
  'NW:Aachen': true,
  'NW:Alsdorf': true,
  'NW:Baesweiler': true,
  'NW:Eschweiler': true,
  'NW:Herzogenrath': true,
  'NW:Monschau': true,
  'NW:Roetgen': true,
  'NW:Simmerath': true,
  'NW:Stolberg': true,
  'NW:Würselen': true
}
