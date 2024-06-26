const { version } = require('@/../package.json')
const { getCountries } = require('@/services/lex')
const redis = require('@/services/redis')

const {
  ACC_TYPES: accTypes,
  OFFER_STATUSES: offerStatuses,
  ORDER_STATUSES: orderStatuses,
  BOOKING_REQUEST_TYPES: bookingRequestTypes,
  BOOKING_REQUEST_STATUSES: bookingRequestStatuses,
  FRAME_MOUNT_REQUEST_STATUSES: frameMountRequestStatuses,
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
  },
  'cube-flags': { CUBE_FLAGS: cubeFlags, EXCLUDE_CITIES_PER_PARTNER: excludeCitiesPerPartner }
} = require('require-dir')('./', {
  recurse: true
})

require('@/jobs')
DEVELOPMENT && require('@/queues')
DEVELOPMENT && require('@/development')

Parse.Cloud.define('init', async ({ params: { keys = [] }, user }) => {
  if (!user) { keys = ['states', 'housingTypes', 'printPackages'] }
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
  offerStatuses,
  orderStatuses,
  bookingRequestTypes,
  bookingRequestStatuses,
  frameMountRequestStatuses,
  cubeStatuses,
  invoiceStatuses,
  creditNoteStatuses,
  paymentTypes,
  billingCycles,
  printPackageTypes,
  printPackageFaces,
  printPackageFiles,
  interestRates,
  taskListStatuses,
  fieldworkStatuses,
  cubeFlags,
  excludeCitiesPerPartner
}))

Parse.Cloud.define('counts', async ({ user }) => {
  let counts = await redis.hgetall('counts')
  if (!Object.keys(counts).length) {
    counts = {
      invoices_not_sent: await $query('Invoice')
        .equalTo('status', 2)
        .equalTo('mailStatus', null)
        .equalTo('postStatus', null)
        .count({ useMasterKey: true }),
      creditNotes_not_sent: await $query('CreditNote')
        .equalTo('status', 2)
        .equalTo('mailStatus', null)
        .equalTo('postStatus', null)
        .count({ useMasterKey: true })
    }
    await redis.hmset('counts', counts)
    await redis.expire('counts', 60)
  }
  return counts
}, $internOrAdmin)

Parse.Cloud.define('stats', async () => {
  const monthlies = await redis.hgetall('stats:monthlies')
    .then(stats => Object.keys(stats).reduce((acc, key) => {
      acc[key] = JSON.parse(stats[key])
      return acc
    }, {}))
  const cubeTotals = await redis.hgetall('stats:cube-totals')
  return { monthlies, cubeTotals }
}, $adminOnly)

Parse.Cloud.define('counts', async ({ user }) => {
  let counts = await redis.hgetall('counts')
  if (!Object.keys(counts).length) {
    counts = {
      invoices_not_sent: await $query('Invoice')
        .equalTo('status', 2)
        .equalTo('mailStatus', null)
        .equalTo('postStatus', null)
        .count({ useMasterKey: true }),
      creditNotes_not_sent: await $query('CreditNote')
        .equalTo('status', 2)
        .equalTo('mailStatus', null)
        .equalTo('postStatus', null)
        .count({ useMasterKey: true })
    }
    await redis.hmset('counts', counts)
    await redis.expire('counts', 60)
  }
  return counts
}, $internOrAdmin)
