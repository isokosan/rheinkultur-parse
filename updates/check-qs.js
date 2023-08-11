async function check () {
  const reports = await $query('QuarterlyReport').find({ useMasterKey: true })
  const response = {}
  for (const report of reports) {
    const quarter = report.get('quarter')
    response[quarter] = {}
    const distributors = report.get('distributors')
    const partnerQuarters = await $query('PartnerQuarter').equalTo('quarter', quarter).find({ useMasterKey: true })
    for (const partnerQuarter of partnerQuarters) {
      const companyId = partnerQuarter.get('company').id
      response[quarter][companyId] = {
        partner: {
          total: partnerQuarter.get('total'),
          bookings: partnerQuarter.get('bookingCount')
        },
        report: {
          total: distributors[companyId].total,
          bookings: distributors[companyId].orders
        }
      }
    }
    console.log(response[quarter])
  }
}

require('./run')(() => check())
