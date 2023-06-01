if (!DEVELOPMENT) {
  throw new Error('Can only require in development mode')
}

Parse.Cloud.define('goto', async ({ params: { date } }) => {
  if (!moment(date).isAfter(await $today(), 'day')) {
    throw new Error('Can only travel to the future.')
  }
  const today = moment(date).format('YYYY-MM-DD')
  return Parse.Config.save({ today })
})
