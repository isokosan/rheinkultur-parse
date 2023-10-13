// SHOULD RETURN NO ISSUES
require('./run')(async () => {
  const issues = {}
  for (const className of ['Contract', 'Booking']) {
    await $query(className)
      .equalTo('canceledAt', null)
      .equalTo('voidedAt', null)
      .select([
        'no',
        'startsAt',
        'initialDuration',
        'extendedDuration',
        'autoExtendsBy',
        'voidedAt',
        'canceledAt',
        'noticePeriod',
        'autoExtendsAt',
        'endsAt'
      ])
      .eachBatch((records) => {
        for (const record of records) {
          const autoExtendsAt = record.get('autoExtendsBy')
            ? moment(record.get('endsAt')).subtract(record.get('noticePeriod') || 0, 'months').format('YYYY-MM-DD')
            : null

          if ((record.get('autoExtendsAt') || null) !== autoExtendsAt) {
            issues[record.get('no')] = {
              ...issues[record.get('no')],
              shouldAutoExtendAt: autoExtendsAt,
              autoExtendsAt: record.get('autoExtendsAt')
            }
          }
        }
      }, { useMasterKey: true })
  }
  console.log(issues)

  // UNCOMMENT TO ATTEMPT FIX
  // for (const item of Object.values(issues)) {
  //   const className = item.no.startsWith('B') ? 'Booking' : 'Contract'
  //   const order = await $query(className).equalTo('no', item.no).first({ useMasterKey: true })
  //   if (item.shouldEndAt && item.shouldEndAt !== order.get('endsAt')) {
  //     console.log('update end at', item.no, order.get('endsAt'), '=>', item.shouldEndAt)
  //     order.set('endsAt', item.shouldEndAt)
  //   }
  //   if (item.shouldAutoExtendAt && item.shouldAutoExtendAt !== order.get('autoExtendsAt')) {
  //     console.log('update auto extend at', item.no, order.get('autoExtendsAt'), '=>', item.shouldAutoExtendAt)
  //     order.set('autoExtendsAt', item.shouldAutoExtendAt)
  //   }
  //   await order.save(null, { useMasterKey: true, context: { setCubeStatuses: true } })
  // }
})
