async function check () {
  let i = 0
  await $query('Audit')
    .equalTo('fn', 'cube-update')
    .notEqualTo('data.changes.gp', null)
    .notEqualTo('user', null)
    .include('item')
    .each(async (audit) => {
      const gp = audit.get('data').changes.gp[1]
      const cube = await $getOrFail('Cube', audit.get('itemId'))
      cube.set({ gp })
      await $saveWithEncode(cube, null, { useMasterKey: true })
      i++
      console.log('cube gp change re-applied', cube.id)
    }, { useMasterKey: true })
  console.info('done', i)
}

require('./run')(() => check())
