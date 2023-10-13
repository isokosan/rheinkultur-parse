// SHOULD RETURN NO ISSUES
require('./run')(async () => {
  const issues = {}
  for (const className of ['Contract', 'Booking']) {
    await $query(className)
      .equalTo('voidedAt', null)
      .select([
        'no',
        'startsAt',
        'initialDuration',
        'extendedDuration',
        'autoExtendsBy',
        'canceledAt',
        'noticePeriod',
        // wanna turn into calculated values in the future, would need a "newEndsAt" date to set when canceling
        'autoExtendsAt',
        'endsAt'
      ])
      .eachBatch((records) => {
        for (const record of records) {
          const { no, startsAt, initialDuration, extendedDuration, autoExtendsBy, autoExtendsAt, canceledAt, noticePeriod, endsAt } = record.attributes
          const totalDuration = initialDuration + (extendedDuration || 0)

          const shouldEndAt = moment(startsAt).add(totalDuration, 'months').subtract(1, 'day').format('YYYY-MM-DD')
          if (!canceledAt && endsAt !== shouldEndAt) {
            issues[no] = { no, shouldEndAt, endsAt, extendedDuration }
          }

          if (!autoExtendsBy && !autoExtendsAt && canceledAt) {
            // was early canceled but never had an extension
            // continue
          }
          if (!autoExtendsBy && !canceledAt && autoExtendsAt) {
            issues[no] = { no, error: 'autoExtendsAt without autoExtendsBy' }
            continue
          }
          if (!autoExtendsAt && !canceledAt && autoExtendsBy) {
            issues[no] = { no, error: 'autoExtendsBy without autoExtendsAt' }
          }
          if (autoExtendsBy && !canceledAt) {
            const shouldAutoExtendAt = moment(endsAt).subtract(noticePeriod || 0, 'months').format('YYYY-MM-DD')
            if (autoExtendsAt !== shouldAutoExtendAt) {
              issues[no] = { no, autoExtendsAt, endsAt, noticePeriod, shouldAutoExtendAt, extendedDuration }
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
