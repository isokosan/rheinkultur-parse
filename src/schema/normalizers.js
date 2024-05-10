const { ACC_TYPES, PERMISSIONS } = require('./enums')

const boolean = value => value === true
const defined = value => value || null
const normalizeString = value => value ? value.trim() : null
const normalizeDateString = value => value instanceof Date ? moment(value).format('YYYY-MM-DD') : value
const normalizeCubeIds = value => [...new Set(value || [])].sort()
const normalizeInt = value => value ? parseInt(value) : null
const normalizeEmail = value => value ? value.trim().toLowerCase() : null
const normalizeUsernameFromEmail = (email) => {
  const [username, domain] = email.split('@')
  return [username.replace(/\./g, ''), domain].join('@')
}

const ORDER_UNSET_NULL_FIELDS = [
  'motive',
  'externalOrderNo',
  'campaignNo',
  'autoExtendsBy',
  'noticePeriod'
]

const ORDER_FIELD_NORMALIZERS = {
  motive: normalizeString,
  externalOrderNo: normalizeString,
  campaignNo: normalizeString,
  cubeIds: normalizeCubeIds,
  startsAt: normalizeDateString,
  endsAt: normalizeDateString,
  initialDuration: normalizeInt,
  autoExtendsBy: normalizeInt,
  noticePeriod: normalizeInt
}

function normalizeOrderFields (normalized) {
  if (!normalized.autoExtendsBy) {
    normalized.autoExtendsBy = null
    normalized.noticePeriod = null
  }
  return normalized
}

module.exports = {
  defined,
  normalizeString,
  normalizeDateString,
  normalizeCubeIds,
  normalizeInt,
  normalizeUsernameFromEmail,
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
      'permissions'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        prefix: normalizeString,
        firstName: normalizeString,
        lastName: normalizeString,
        email: normalizeEmail,
        pbx: normalizeString,
        mobile: normalizeString,
        companyId: defined,
        companyPersonId: defined,
        accType (val) {
          return Object.keys(ACC_TYPES).includes(val) ? val : null
        },
        permissions (val) {
          val = val || []
          if (!Array.isArray(val)) val = [val]
          val = val.filter(role => Object.keys(PERMISSIONS).includes(role))
          return val.length ? val : null
        }
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      // if companyId is set, permissions have manage-frames, the companyId can only be Stadtkultur GMBH
      if (normalized.companyId && normalized.permissions?.includes('manage-frames') && normalized.companyId !== '19me3Ge8LZ') {
        throw new Error('Bad Request with invalid permissions')
      }
      return normalized
    }
  },
  companies: {
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        name: normalizeString,
        email: normalizeString,
        branch: normalizeString,
        dueDays: x => normalizeInt(x) ?? 14,
        paymentType: x => parseInt(['0', '1'].includes(x) ? x : '0'),
        contractDefaults (defaults = {}) {
          const { pricingModel, fixedPrice, fixedPriceMap, updateFixedPrices, gradualPriceMapId } = defaults
          const billingCycle = normalizeInt(defaults.billingCycle) || undefined
          if (pricingModel === 'fixed') {
            return $cleanDict({ pricingModel, fixedPrice, fixedPriceMap, billingCycle, updateFixedPrices })
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
  offers: {
    UNSET_NULL_FIELDS: [
      ...ORDER_UNSET_NULL_FIELDS,
      'companyPerson',
      'monthlyMedia'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        ...ORDER_FIELD_NORMALIZERS,
        companyId: defined,
        companyPersonId: defined
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      return normalizeOrderFields(normalized)
    }
  },
  contracts: {
    UNSET_NULL_FIELDS: [
      ...ORDER_UNSET_NULL_FIELDS,
      'companyPerson',
      'invoiceAddress',
      'invoiceDescription',
      'invoicingAt',
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
        ...ORDER_FIELD_NORMALIZERS,
        offerId: defined,
        companyId: defined,
        addressId: defined,
        companyPersonId: defined,
        differentInvoiceAddress: boolean,
        invoiceAddressId: defined,
        invoicingAt: value => value === 'end' ? 'end' : 'start',
        paymentType: value => value === '1' || value === 1 ? 1 : 0,
        dueDays: normalizeInt,
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
        billingCycle: normalizeInt,
        invoiceDescription: normalizeString,
        pricingModel: value => ['gradual', 'fixed', 'zero'].includes(value) ? value : null,
        disassemblyFromRMV: value => value === 'y'
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
      return normalizeOrderFields(normalized)
    }
  },
  bookings: {
    UNSET_NULL_FIELDS: [
      ...ORDER_UNSET_NULL_FIELDS,
      'companyPerson',
      'endPrices',
      'monthlyMedia'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        ...ORDER_FIELD_NORMALIZERS,
        companyId: defined,
        companyPersonId: defined,
        disassemblyFromRMV: value => value === 'y'
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      return normalizeOrderFields(normalized)
    }
  },
  specialFormats: {
    UNSET_NULL_FIELDS: [
      ...ORDER_UNSET_NULL_FIELDS,
      'companyPerson',
      'sfCounts'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        ...ORDER_FIELD_NORMALIZERS,
        companyId: defined,
        companyPersonId: defined,
        disassemblyFromRMV: value => value === 'y'
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      return normalizeOrderFields(normalized)
    }
  },
  frameMounts: {
    UNSET_NULL_FIELDS: [
      'reservedUntil',
      'companyPerson',
      'planned',
      'fmCounts'
    ],
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        companyId: defined,
        cubeIds: normalizeCubeIds,
        reservedUntil: normalizeDateString,
        companyPersonId: defined,
        pk: defined,
        planned: normalizeInt
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      return normalizeOrderFields(normalized)
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
        invoiceIds: defined,
        date: normalizeDateString,
        periodStart: normalizeDateString,
        periodEnd: normalizeDateString,
        introduction: normalizeString,
        mediaItems (items) {
          for (const key of Object.keys(items || {})) {
            if (!items[key].total) {
              delete items[key]
            }
          }
          return items
        },
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
  taskLists: {
    normalizeFields (form) {
      const FIELD_NORMALIZERS = {
        type: value => ['scout', 'control', 'assembly', 'disassembly', 'special-format'].includes(value) ? value : null,
        name: normalizeString,
        quota: normalizeInt,
        quotas: value => $cleanDict({ MFG: value?.MFG || undefined, KVZ: value?.KVZ || undefined }),
        dueDate: normalizeDateString,
        managerId: defined,
        scoutIds: values => values ? values.filter(value => value) : null,
        cubeIds: normalizeCubeIds
      }
      const normalized = {}
      for (const key of Object.keys(form).filter(key => key in FIELD_NORMALIZERS)) {
        normalized[key] = FIELD_NORMALIZERS[key](form[key])
      }
      if (!['scout', 'special-format'].includes(normalized.type)) {
        delete normalized.quota
        delete normalized.quotas
      }
      if (normalized.quota) {
        delete normalized.quotas
      }
      if (normalized.quotas) {
        delete normalized.quota
      }
      return normalized
    }
  }
}
