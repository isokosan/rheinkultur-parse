async function check () {
  await $query('Contract')
    .select(['startsAt', 'endsAt', 'autoExtendsBy', 'initialDuration', 'extendedDuration', 'canceledAt'])
    .eachBatch((contracts) => {
      for (const contract of contracts) {
        const shouldEndAt = moment(contract.get('startsAt'))
          .add(contract.get('initialDuration') || 0, 'months')
          .add(contract.get('extendedDuration') || 0, 'months')
          .subtract(1, 'day')
          .format('YYYY-MM-DD')
        const endsAt = contract.get('endsAt')
        if (endsAt !== shouldEndAt) {
          console.log(`Contract ${contract.id} endsAt should be ${shouldEndAt} but is ${endsAt}`)
        }
      }
    })
}

require('./run')(() => check())
