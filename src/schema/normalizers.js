const { ACC_TYPES, DISTRIBUTOR_ROLES } = require('./enums')

const boolean = value => value === true
const defined = value => value || null
const normalizeString = value => value ? value.trim() : null
const normalizeDateString = value => value instanceof Date ? moment(value).format('YYYY-MM-DD') : value
const normalizeCubeIds = value => [...new Set(value || [])].sort()
const normalizeInt = value => value ? parseInt(value) : null

module.exports = {
  defined,
  normalizeString,
  normalizeDateString,
  normalizeCubeIds,
  normalizeInt,
  users: {
    UNSET_NULL_FIELDS: [
      'company',
      'prefix',
      'firstName',
      'lastName',
      'email',
      'pbx',
      'mobile',
      'companyPerson',
      'accType',
      'distributorRoles'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        prefix: normalizeString,
        firstName: normalizeString,
        lastName: normalizeString,
        email: normalizeString,
        pbx: normalizeString,
        mobile: normalizeString,
        companyId: defined,
        companyPersonId: defined,
        accType (val) {
          return Object.keys(ACC_TYPES).includes(val) ? val : null
        },
        distributorRoles (val) {
          val = val || []
          if (!Array.isArray(val)) val = [val]
          val = val.filter(role => Object.keys(DISTRIBUTOR_ROLES).includes(role))
          return val.length ? val : null
        }
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      if (normalized.accType === 'distributor' && !normalized.distributorRoles) {
        normalized.distributorRoles = []
      }
      return normalized
    }
  },
  companies: {
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        name: normalizeString,
        email: normalizeString,
        dueDays: x => normalizeInt(x) ?? 14,
        paymentType: x => parseInt(['0', '1'].includes(x) ? x : '0'),
        contractDefaults (defaults = {}) {
          const { pricingModel, fixedPrice, fixedPriceMap, gradualPriceMapId } = defaults
          const billingCycle = normalizeInt(defaults.billingCycle) || undefined
          if (pricingModel === 'fixed') {
            return { pricingModel, fixedPrice, fixedPriceMap, billingCycle }
          }
          if (pricingModel === 'gradual') {
            return { pricingModel, billingCycle, gradualPriceMapId }
          }
          if (pricingModel === 'default') {
            return { billingCycle }
          }
          return { pricingModel, billingCycle }
        }
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      return normalized
    }
  },
  persons: {
    UNSET_NULL_FIELDS: [
      'firstName',
      'lastName',
      'title',
      'email',
      'pbx',
      'mobile'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        prefix: normalizeString,
        firstName: normalizeString,
        lastName: normalizeString,
        title: normalizeString,
        email: normalizeString,
        pbx: normalizeString,
        mobile: normalizeString,
        companyId: defined
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      return normalized
    }
  },
  addresses: {
    UNSET_NULL_FIELDS: [
      'companyId',
      'lex',
      'name',
      'supplement',
      'street',
      'zip',
      'city',
      'countryCode',
      'pbx',
      'email'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        lex: defined,
        name: normalizeString,
        supplement: normalizeString,
        street: normalizeString,
        zip: normalizeString,
        city: normalizeString,
        countryCode: normalizeString,
        pbx: normalizeString,
        email: normalizeString,
        companyId: defined
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      if (normalized.lex) {
        normalized.name = normalized.lex.name
      }
      return normalized
    }
  },
  contracts: {
    UNSET_NULL_FIELDS: [
      'motive',
      'externalOrderNo',
      'campaignNo',
      'companyPerson',
      'invoiceAddress',
      'invoiceDescription',
      'invoicingAt',
      'autoExtendsAt',
      'autoExtendsBy',
      'noticePeriod',
      'pricingModel',
      'gradualPriceMap',
      'agency',
      'agencyPerson',
      'commission',
      'commissions',
      'monthlyMedia'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        companyId: defined,
        addressId: defined,
        companyPersonId: defined,
        differentInvoiceAddress: boolean,
        invoiceAddressId: defined,
        invoicingAt: value => value === 'end' ? 'end' : 'start',
        paymentType: value => value === '1' || value === 1 ? 1 : 0,
        dueDays: normalizeInt,
        motive: normalizeString,
        externalOrderNo: normalizeString,
        campaignNo: normalizeString,
        cubeIds: normalizeCubeIds,
        startsAt: normalizeDateString,
        endsAt: normalizeDateString,
        agencyId: defined,
        agencyPersonId: defined,
        commission: value => value ? parseFloat(`${value}`.replace(',', '.')) : null,
        commissions (value) {
          if (value) {
            for (const year of Object.keys(value)) {
              if (`${year}`.length !== 4) {
                delete value[year]
                continue
              }
              const rate = parseFloat(`${value[year]}`.replace(',', '.'))
              if (typeof rate !== 'number') {
                delete value[year]
                continue
              }
              value[year] = rate
            }
            return Object.keys(value).length ? value : null
          }
          return null
        },
        initialDuration: normalizeInt,
        billingCycle: normalizeInt,
        autoExtendsAt: normalizeDateString,
        autoExtendsBy: normalizeInt,
        noticePeriod: normalizeInt,
        invoiceDescription: normalizeString,
        pricingModel: value => ['gradual', 'fixed', 'zero'].includes(value) ? value : null
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      if (normalized.pricingModel === 'zero') {
        normalized.billingCycle = 0
      }
      if (normalized.invoiceAddressId === normalized.addressId) {
        normalized.differentInvoiceAddress = false
      }
      if (!normalized.differentInvoiceAddress) {
        normalized.invoiceAddressId = undefined
      }
      if (!normalized.agencyId) {
        normalized.agencyPersonId = undefined
        normalized.commission = undefined
        normalized.commissions = undefined
      }
      if (!normalized.autoExtendsBy) {
        normalized.autoExtendsBy = null
        normalized.noticePeriod = null
        normalized.autoExtendsAt = null
      }
      return normalized
    }
  },
  bookings: {
    UNSET_NULL_FIELDS: [
      'companyPerson',
      'autoExtendsAt',
      'autoExtendsBy',
      'noticePeriod',
      'motive',
      'externalOrderNo',
      'campaignNo',
      'endPrices',
      'monthlyMedia'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        companyId: defined,
        companyPersonId: defined,
        motive: normalizeString,
        externalOrderNo: normalizeString,
        campaignNo: normalizeString,
        cubeIds: normalizeCubeIds,
        startsAt: normalizeDateString,
        endsAt: normalizeDateString,
        initialDuration: normalizeInt,
        autoExtendsAt: normalizeDateString,
        autoExtendsBy: normalizeInt,
        noticePeriod: normalizeInt
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      if (!normalized.autoExtendsBy) {
        normalized.autoExtendsBy = null
        normalized.noticePeriod = null
        normalized.autoExtendsAt = null
      }
      return normalized
    }
  },
  invoices: {
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        companyId: defined,
        addressId: defined,
        companyPersonId: defined,
        contractId: defined,
        bookingId: defined,
        date: normalizeDateString,
        paymentType: value => value === '1' || value === 1 ? 1 : 0,
        dueDays: normalizeInt,
        periodStart: normalizeDateString,
        periodEnd: normalizeDateString,
        agencyId: defined,
        commissionRate: normalizeInt,
        lessorId: defined,
        lessorRate: normalizeInt,
        introduction: normalizeString,
        lineItems (value) {
          const lineItems = value || []
          for (const item of lineItems) {
            if (`${item.price}`.split('.')[1]?.length > 2) {
              throw new Error('Bad Request with invalid line item price')
            }
          }
          return lineItems
        },
        extraCols (value) {
          if (!value || !Object.keys(value).length) {
            return null
          }
          for (const key of Object.keys(value)) {
            if (!value[key]) {
              delete value[key]
            }
          }
          return value
        }
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      if (!normalized.agencyId) {
        normalized.commissionRate = undefined
      }
      if (!normalized.lessorId) {
        normalized.lessorRate = undefined
      }
      return normalized
    }
  },
  creditNotes: {
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        companyId: defined,
        addressId: defined,
        companyPersonId: defined,
        contractId: defined,
        bookingId: defined,
        invoiceId: defined,
        date: normalizeDateString,
        periodStart: normalizeDateString,
        periodEnd: normalizeDateString,
        introduction: normalizeString,
        lineItems (value) {
          const lineItems = value || []
          for (const item of lineItems) {
            if (`${item.price}`.split('.')[1]?.length > 2) {
              throw new Error('Bad Request with invalid line item price')
            }
            if (!item.discount) {
              delete item.discount
            }
          }
          return lineItems
        }
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      return normalized
    }
  },
  departureLists: {
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        type: value => ['scout', 'control'].includes(value) ? value : null,
        name: normalizeString,
        quota: normalizeInt,
        dueDate: normalizeDateString,
        scoutId: defined,
        cubeIds: normalizeCubeIds
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      if (normalized.type !== 'scout') {
        delete normalized.quota
      }
      return normalized
    }
  }
}
