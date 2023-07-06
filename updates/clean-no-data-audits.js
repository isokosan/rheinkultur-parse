// TODO: Check again later if they are coming
async function cleanAudits (preview) {
  let i = 0
  await $query('Audit')
    .equalTo('data', null)
    .endsWith('fn', '-update')
    .select(['fn', 'itemId', 'data'])
    .each(async (audit) => {
      console.log(audit.get('fn'), audit.get('itemId'), audit.get('data'))
      // await audit.destroy({ useMasterKey: true })
      i++
    }, { useMasterKey: true })
  console.info({ i })
  return i
}

require('./run')(() => cleanAudits())
