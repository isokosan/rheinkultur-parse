async function check () {
  // return $query('Booking').notEqualTo('earlyCancellations', null).count({ useMasterKey: true }).then(console.log)

  const reports = await $query('QuarterlyReport').notEqualTo('status', null).find({ useMasterKey: true })
  const response = {}
  for (const report of reports) {
    const quarter = report.get('quarter')
    const distributors = report.get('distributors')
    const partnerQuarters = await $query('PartnerQuarter').equalTo('quarter', quarter).include('company').find({ useMasterKey: true })
    for (const companyId of Object.keys(distributors)) {
      if (!response[companyId]) {
        response[companyId] = {}
      }
      response[companyId][quarter] = {
        report: {
          total: distributors[companyId].total,
          bookings: distributors[companyId].orders
        },
        partner: null
      }
      const partnerQuarter = partnerQuarters.find(pq => pq.get('company').id === companyId)
      if (partnerQuarter) {
        response[companyId].name = partnerQuarter.get('company').get('name')
        response[companyId][quarter].partner = {
          total: partnerQuarter.get('total'),
          bookings: partnerQuarter.get('count')
        }
      }
    }
  }
  for (const item of Object.values(response)) {
    console.log(item)
  }
}
require('./run')(() => check())
