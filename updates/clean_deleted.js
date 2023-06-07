async function cleanDeleted () {
  let c = 0
  let b = 0
  await $query('Contract').notEqualTo('deletedAt', null).each(async (contract) => {
    // if (contract.get('status') !== -1) { throw new Error('different status') }
    await contract.set('status', 0).save(null, { useMasterKey: true })
    await contract.destroy({ useMasterKey: true })
    c++
  }, { useMasterKey: true })
  await $query('Booking').notEqualTo('deletedAt', null).each(async (booking) => {
    // if (booking.get('status') !== -1) { throw new Error('different status') }
    await booking.set('status', 0).save(null, { useMasterKey: true })
    await booking.destroy({ useMasterKey: true })
    b++
  }, { useMasterKey: true })
  consola.info({ b, c })
}

require('./run')(cleanDeleted)
