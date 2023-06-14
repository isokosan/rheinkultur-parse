const { parseAsDigitString } = require('@/utils')

const UnsyncedLexDocument = Parse.Object.extend('UnsyncedLexDocument')

Parse.Cloud.afterSave(UnsyncedLexDocument, async ({ object: doc }) => {
  const systemStatus = await Parse.Config.get().then(config => config.get('systemStatus') || {})
  systemStatus.unsyncedLexDocuments = await $query(UnsyncedLexDocument).count({ useMasterKey: true })
  await Parse.Config.save({ systemStatus })
})

Parse.Cloud.afterDelete(UnsyncedLexDocument, async ({ object: doc }) => {
  const systemStatus = await Parse.Config.get().then(config => config.get('systemStatus') || {})
  systemStatus.unsyncedLexDocuments = await $query(UnsyncedLexDocument).count({ useMasterKey: true })
  await Parse.Config.save({ systemStatus })
})

async function updateUnsyncedLexDocument (type, resource) {
  const unsyncedLexDocument = await $query(UnsyncedLexDocument)
    .equalTo('type', type)
    .equalTo('lexId', resource.id)
    .first({ useMasterKey: true }) ||
    new UnsyncedLexDocument({ type, lexId: resource.id })
  return unsyncedLexDocument
    .set({ resource })
    .save(null, { useMasterKey: true })
}

Parse.Cloud.define('system-status-vouchers', async () => {
  const years = [moment().year() % 2000]
  const vouchers = {}
  const skippedNumbers = []
  for (const year of years) {
    vouchers[year] = { Invoice: { skipped: [] }, CreditNote: { skipped: [] } }
    for (const [className, classPrefix] of [['Invoice', 'RE'], ['CreditNote', 'GS']]) {
      const prefix = classPrefix + year + '-'
      const nos = await $query(className)
        .startsWith('lexNo', prefix)
        .notEqualTo('lexNo', null)
        .distinct('lexNo', { useMasterKey: true })
      let carry
      vouchers[year][className].start = nos[0]
      vouchers[year][className].end = nos[nos.length - 1]
      vouchers[year][className].total = nos.length
      for (const no of nos) {
        if (!carry) { carry = parseInt(no.replace(prefix, '')) }
        const number = parseInt(no.replace(prefix, ''))
        if (number !== carry) {
          const skippedNumber = prefix + (parseAsDigitString(carry, 5))
          vouchers[year][className].skipped.push(skippedNumber)
          skippedNumbers.push(skippedNumber)
          carry++
        }
        carry++
      }
    }
  }
  const systemStatus = await Parse.Config.get().then(config => config.get('systemStatus') || {})
  systemStatus.skippedNumbers = skippedNumbers
  await Parse.Config.save({ systemStatus })
  return vouchers
}, $internOrAdmin)

module.exports.updateUnsyncedLexDocument = updateUnsyncedLexDocument

// TODO: Move to updates folder

// // CHECK OVERLAPPING PLANNED INVOICES OF CONTRACTS
// Parse.Cloud.define('manual-updates-check-contract-invoices', async () => {
//   const allInvoices = await $query('Invoice')
//     .notEqualTo('periodStart', null)
//     .notEqualTo('periodEnd', null)
//     .notEqualTo('media', null)
//     .notEqualTo('contract', null)
//     .notContainedIn('status', [3, 4]) // canceled
//     .ascending('periodStart')
//     .select('contract.no', 'contract.startsAt', 'contract.initialDuration', 'contract.extendedDuration', 'periodStart', 'periodEnd')
//     .limit(10000)
//     .find({ useMasterKey: true })
//   const contracts = {}
//   for (const invoice of allInvoices) {
//     const contractNo = invoice.get('contract').get('no')
//     if (!contracts[contractNo]) {
//       const { startsAt, initialDuration, extendedDuration } = invoice.get('contract').attributes
//       const endsAt = moment(startsAt).add(initialDuration, 'months').add(extendedDuration, 'months').subtract(1, 'day').format('YYYY-MM-DD')
//       contracts[contractNo] = { startsAt, endsAt, periods: [] }
//     }
//     const start = invoice.get('periodStart')
//     const end = invoice.get('periodEnd')

//     contracts[contractNo].periods.push([start, end])
//   }
//   const contractNos = Object.keys(contracts)
//   for (const contractNo of contractNos) {
//     const errors = []
//     const { startsAt, endsAt, periods } = contracts[contractNo]
//     let nextStart
//     let finalEnd
//     const ends = []
//     for (const [start, end] of periods) {
//       if (nextStart && start !== nextStart) {
//         errors.push({ periods })
//       }
//       nextStart = moment(end).add(1, 'day').format('YYYY-MM-DD')
//       finalEnd = end
//       if (ends.includes(end)) {
//         errors.push({ duplicateEnd: end })
//       }
//       ends.push(end)
//     }
//     if (finalEnd !== endsAt) {
//       errors.push({ finalEnd })
//     }
//     if (!errors.length) {
//       delete contracts[contractNo]
//       continue
//     }
//     contracts[contractNo] = { startsAt, endsAt, errors }
//   }
//   return contracts
// }, { requireMaster: true })

// // CHECK END DATES OF NON-CANCELED CONTRACTS
// Parse.Cloud.define('manual-updates-check-end-dates', async () => {
//   const contracts = await $query('Contract')
//     .equalTo('canceledAt', null)
//     .select(['no', 'startsAt', 'initialDuration', 'extendedDuration', 'endsAt'])
//     .limit(1000)
//     .find({ useMasterKey: true })
//   const response = {}
//   for (const contract of contracts) {
//     const { no, startsAt, endsAt } = contract.attributes
//     const shouldEndAt = moment(startsAt)
//       .add(contract.get('initialDuration'), 'months')
//       .add(contract.get('extendedDuration') || 0, 'months')
//       .subtract(1, 'day')
//       .format('YYYY-MM-DD')
//     if (shouldEndAt !== endsAt) {
//       response[no] = { startsAt, endsAt, shouldEndAt }
//     }
//   }
//   return response
// }, { requireMaster: true })

// // CHECK END DATES OF CANCELED CONTRACTS
// Parse.Cloud.define('manual-updates-check-canceled-end-dates', async () => {
//   const contracts = await $query('Contract')
//     .notEqualTo('canceledAt', null)
//     .limit(1000)
//     .find({ useMasterKey: true })
//   const response = {}
//   for (const contract of contracts) {
//     const endsAt = contract.get('endsAt')
//     const shouldEndAt = moment(contract.get('startsAt'))
//       .add(contract.get('initialDuration'), 'months')
//       .add(contract.get('extendedDuration') || 0, 'months')
//       .subtract(1, 'day')
//       .format('YYYY-MM-DD')
//     if (shouldEndAt === endsAt) {
//       consola.info(contract.get('no'))
//       continue
//     }
//     response[contract.get('no')] = {
//       endsAt: shouldEndAt,
//       newEndsAt: endsAt
//     }
//   }
//   return response
// }, { requireMaster: true })
