const { isEqual, cloneDeep } = require('lodash')
const { companies: { normalizeFields } } = require('@/schema/normalizers')
const Company = Parse.Object.extend('Company')

/*
  ContractDefaults: {
    billingCycle: number // (1 | 3 | 6 | 12)
    pricingModel?: string // (gradual | fixed) if empty - then default (which is vertrag based entry)
    fixedPrice?: MediaPrice // only if model is fixed, and single price
    fixedPriceMap?: MediaPriceMap // only if model is fixed { mediaNo: price, default: price }
    gradualPriceMapId?: Which gradual pricing is applied (currently only ALDI is available)
  }
  DistributorOptions: {
    pricingModel?: string // (fixed | commission) default if empty (which is booking based (rheinkultur netto) entry)
    fixedPrice?: MediaPriceMap // only if model is fixed, and single price
    fixedPriceMap?: MediaPriceMap // only if model is fixed { mediaNo: price, default: price }
    commission?: number // only if model is commission
  }
  AgencyOptions: {
    earningsVia: 'invoice' | 'credit-note'
    commissions?: Object {
      [rate: string] => description: string // rate uses comma for decimal separation
    }
  }
  LessorOptions: {
    code: string // Lessor Code Eg: TLK for Telekom
    rate: number // Default Lessor Rate Eg: 24% for Telekom
    cycle: number // Lessor Cycle in months: 3 months for Quarterly Pacht Calculations
    exceptions: Object {
      ort: [ort: string] => number // Berlin for example 64%
      plz: [plz: string] => number // this takes precedence over ort exceptions if collides
      customer: [companyId: string] => number // if customer of contract is kinetic for example. this takes precendence over plz and ort exceptions
    }
  }
  ScoutorOptions: {
    -
  }
*/

Parse.Cloud.beforeFind(Company, ({ query }) => {
  if (!('deletedAt' in query._where) && !query._include.includes('deleted')) {
    query.equalTo('deletedAt', null)
  }
  query._include.includes('all') && query.include(['deleted', 'docs', 'persons', 'addresses'])
  if (!('deletedAt' in query._where) && !query._include.includes('deleted')) {
    query.equalTo('deletedAt', null)
  }
})

Parse.Cloud.afterFind(Company, async ({ query, objects: companies }) => {
  // set default
  for (const company of companies) {
    company.get('dueDays') === undefined && company.set('dueDays', 14)
  }

  if (query._include.includes('persons')) {
    for (const company of companies) {
      const persons = await $query('Person').equalTo('company', company).find({ useMasterKey: true })
      company.set('persons', persons)
    }
  }
  if (query._include.includes('addresses')) {
    for (const company of companies) {
      const addresses = await $query('Address').equalTo('company', company).find({ useMasterKey: true })
      company.set('addresses', addresses)
    }
  }
  return companies
})

Parse.Cloud.afterSave(Company, async ({ object: company, context: { audit } }) => { $audit(company, audit) })

Parse.Cloud.beforeDelete(Company, ({ object: company }) => {
  if (company.get('lessor')) {
    throw new Error('Verpächter kann nicht gelöscht werden.')
  }
})

Parse.Cloud.define('company-create', async ({
  params: {
    // only for seeding
    importNo,
    distributor,
    agency,
    lessor,
    scoutor,
    tagIds,
    // form data
    ...params
  }, user, master
}) => {
  const {
    name,
    email,
    paymentType,
    dueDays,
    contractDefaults
  } = normalizeFields(params)

  const company = new Company({
    name,
    email,
    paymentType,
    dueDays,
    contractDefaults,
    responsibles: user ? [user] : undefined
  })

  // only for seeding
  if (master) {
    tagIds && company.set({ tags: await $query('Tag').containedIn('objectId', tagIds).find({ useMasterKey: true }) })
    company.set({
      importNo,
      distributor,
      agency,
      lessor,
      scoutor
    })
  }

  const audit = { user, fn: 'company-create' }
  return company.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('company-update-info', async ({
  params: {
    id: companyId,
    ...params
  }, user
}) => {
  const {
    name,
    email,
    paymentType,
    dueDays,
    contractDefaults
  } = normalizeFields(params)

  const company = await $getOrFail(Company, companyId)
  const changes = $changes(company, {
    name,
    email,
    paymentType,
    dueDays,
    contractDefaults
  })

  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen') }
  company.set({ name, email, paymentType, dueDays, contractDefaults })

  const audit = { user, fn: 'company-update-info', data: { changes } }
  return company.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('company-update-distributor', async ({
  params: {
    id: companyId,
    isDistributor,
    pricingModel,
    fixedPrice,
    fixedPriceMap,
    commission
  }, user
}) => {
  fixedPriceMap = $cleanDict(fixedPriceMap)
  if (pricingModel === 'default') {
    pricingModel = undefined
    fixedPrice = undefined
    fixedPriceMap = undefined
    commission = undefined
  }

  if (pricingModel !== 'fixed') {
    fixedPrice = undefined
    fixedPriceMap = undefined
  }
  if (pricingModel !== 'commission') {
    commission = undefined
  }

  const company = await $getOrFail(Company, companyId)
  const distributor = cloneDeep(company.get('distributor'))
  const form = {
    pricingModel,
    fixedPrice,
    fixedPriceMap,
    commission
  }

  const audit = { user }
  // set distributor
  if (!distributor && isDistributor) {
    audit.fn = 'company-set-distributor'
    company.set({ distributor: form })
  }
  // update distributor
  if (distributor && isDistributor) {
    audit.fn = 'company-update-distributor'
    const data = { changes: $changes(distributor, form, true) }
    company.set({ distributor: form })
    audit.data = data
  }
  // unset distributor
  if (distributor && !isDistributor) {
    audit.fn = 'company-unset-distributor'
    company.unset('distributor')
  }

  return company.save(null, { useMasterKey: true, context: { audit } })
}, $adminOnly)

Parse.Cloud.define('company-update-distributor-show-months', async ({
  params: {
    id: companyId,
    showMonths
  }, user
}) => {
  const company = await $getOrFail(Company, companyId)
  const distributor = company.get('distributor')
  if (!distributor) {
    throw new Error('Only distributors')
  }
  if (user.get('company').id !== company.id) {
    throw new Error('Only for own company')
  }
  distributor.showMonths = parseInt(showMonths)
  company.set({ distributor })
  return company.save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('company-update-agency', async ({
  params: {
    id: companyId,
    isAgency,
    earningsVia,
    commissions: commissionsInput
  }, user
}) => {
  const company = await $query(Company).get(companyId, { useMasterKey: true })
  const agency = cloneDeep(company.get('agency'))
  const commissions = {}
  for (const rate of Object.keys(commissionsInput) || {}) {
    commissions[`${parseFloat(rate)}`.replace('.', ',')] = commissionsInput[rate]
  }
  const audit = { user }
  // set agency
  if (!agency && isAgency) {
    audit.fn = 'company-set-agency'
    company.set({ agency: { earningsVia, commissions } })
  }
  // update agency
  if (agency && isAgency) {
    audit.fn = 'company-update-agency'
    // update agency settings / earnings via
    company.set({ agency: { earningsVia, commissions } })
  }
  // unset agency
  if (agency && !isAgency) {
    audit.fn = 'company-unset-agency'
    company.unset('agency')
  }

  return company.save(null, { useMasterKey: true, context: { audit } })
}, $adminOnly)

Parse.Cloud.define('company-update-lessor', async ({
  params: {
    id: companyId,
    isLessor,
    code,
    rate,
    cycle,
    exceptions
  }, user
}) => {
  const company = await $getOrFail(Company, companyId)

  const lessor = cloneDeep(company.get('lessor'))
  const form = {
    code,
    rate,
    cycle,
    exceptions: Object.keys(exceptions || {}).length ? exceptions : undefined
  }

  const audit = { user }

  // set lessor
  if (!lessor && isLessor) {
    audit.fn = 'company-set-lessor'
    // TODO: check lessor code unique
    company.set({ lessor: form })
  }

  // update lessor
  if (lessor && isLessor) {
    audit.fn = 'company-update-lessor'
    const data = {}
    // v2: Allow editing if no cubes exist
    if (code !== lessor.code) {
      throw new Error('You can\'t change Verpächtercode')
    }
    if (rate !== lessor.rate) {
      data.rate = [lessor.rate, rate]
    }

    if (!isEqual(exceptions, lessor.exceptions)) {
      data.exceptions = {}
    }

    if (!Object.keys(data).length) {
      throw new Error('Keine Änderungen')
    }
    company.set({ lessor: form })
    audit.data = data
  }
  // unset lessor
  if (lessor && !isLessor) {
    throw new Error('Unternehmen kann nicht als nicht Verpächter gesetzt werden.')
  }

  return company.save(null, { useMasterKey: true, context: { audit } })
}, $adminOnly)

Parse.Cloud.define('company-remove', async ({ params: { id: companyId }, user }) => {
  const company = await $getOrFail(Company, companyId)
  company.set({ deletedAt: new Date() })
  const audit = { user, fn: 'company-remove' }
  return company.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('company-restore', async ({ params: { id: companyId }, user }) => {
  const company = await $query(Company)
    .notEqualTo('deletedAt', null)
    .equalTo('objectId', companyId)
    .first({ useMasterKey: true })
  company.unset('deletedAt')
  const audit = { user, fn: 'company-restore' }
  return company.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

// TODO: watch for limit
const fetchCompanies = () => $query(Company)
  .include('deleted')
  .limit(1000)
  .find({ useMasterKey: true })

module.exports = {
  fetchCompanies
}
