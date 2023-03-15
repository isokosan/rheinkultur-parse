module.exports = async function (job) {
  let freedCubes = 0
  const earlyCanceledQuery = $query('Cube')
    .notEqualTo('order.earlyCanceledAt', null)
    .lessThan('order.endsAt', await $today())
  while (true) {
    const cube = await earlyCanceledQuery.first({ useMasterKey: true })
    if (!cube) { break }
    cube.unset('order').save(null, { useMasterKey: true })
    freedCubes++
  }
  return Promise.resolve({ freedCubes })
}
