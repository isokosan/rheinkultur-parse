const { cloneDeep } = require('lodash')

async function cleanAudits (preview) {
  let i = 0
  await $query('Audit')
    .notEqualTo('data.changes', null)
    .select(['fn', 'itemId', 'data'])
    .each(async (audit) => {
      const data = cloneDeep(audit.get('data'))
      let cleaned = false
      for (const key of Object.keys(data.changes)) {
        const [before, after] = data.changes[key]
        if (before === after) {
          delete data.changes[key]
          cleaned = true
        }
      }
      if (cleaned) {
        if (!Object.keys(data.changes).length) {
          delete data.changes
        }
        console.info(audit.get('fn'), audit.get('itemId'), audit.get('data'), data)
        i++
        if (preview) {
          return
        }
        Object.keys(data).length
          ? await audit.set({ data }).save(null, { useMasterKey: true })
          : await audit.destroy({ useMasterKey: true })
      }
    }, { useMasterKey: true })
  console.info({ i })
  return i
}

require('./run')(() => cleanAudits())
