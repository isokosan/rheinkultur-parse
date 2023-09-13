// async function check () {
//   // return $query('Booking').notEqualTo('earlyCancellations', null).count({ useMasterKey: true }).then(console.log)

//   const reports = await $query('QuarterlyReport').find({ useMasterKey: true })
//   const response = {}
//   for (const report of reports) {
//     const quarter = report.get('quarter')
//     const distributors = report.get('distributors')
//     const partnerQuarters = await $query('PartnerQuarter').equalTo('quarter', quarter).include('company').find({ useMasterKey: true })
//     for (const companyId of Object.keys(distributors)) {
//       if (!response[companyId]) {
//         response[companyId] = {}
//       }
//       response[companyId][quarter] = {
//         report: {
//           total: distributors[companyId].total,
//           bookings: distributors[companyId].orders
//         },
//         partner: null
//       }
//       const partnerQuarter = partnerQuarters.find(pq => pq.get('company').id === companyId)
//       if (partnerQuarter) {
//         response[companyId].name = partnerQuarter.get('company').get('name')
//         response[companyId][quarter].partner = {
//           total: partnerQuarter.get('total'),
//           bookings: partnerQuarter.get('bookingCount')
//         }
//       }
//     }
//   }
//   for (const item of Object.values(response)) {
//     console.log(item)
//   }
// }

async function recalculate () {
  await $query('Invoice')
    .equalTo('company', $parsify('Company', '4EBkZmBra0'))
    .equalTo('extraCols.Motiv', 'Potsdam Vertrag')
    .equalTo('netTotal', 7000)
    .equalTo('periodicDistributorQuarter', null)
    .each((invoice) => {
      const periodStart = invoice.get('periodStart')
      const quarter = moment(periodStart).format('Q-YYYY')
      invoice.set('periodicDistributorQuarter', quarter)
      console.log('saved periodicDistributorQuarter')
      return invoice.save(null, { useMasterKey: true })
    }, { useMasterKey: true })

  await $query('PartnerQuarter').equalTo('status', 'finalized').each(pq => pq.destroy({ useMasterKey: true }), { useMasterKey: true })
  const partners = await $query('Company').notEqualTo('distributor', null).find({ useMasterKey: true })
  for (const partner of partners) {
    for (const quarter of ['1-2023', '2-2023']) {
      await Parse.Cloud.run('partner-quarter', { companyId: partner.id, quarter }, { useMasterKey: true })
      const pq = await $query('PartnerQuarter').equalTo('company', partner).equalTo('quarter', quarter).first({ useMasterKey: true })
      pq.set('status', 'finalized')
      await pq.save(null, { useMasterKey: true })
      console.log(partner.get('name'), 'done')
    }
  }
}

require('./run')(() => recalculate())
