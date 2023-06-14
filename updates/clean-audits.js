const { cloneDeep } = require('lodash')

async function cleanAudits (preview) {
  let i = 0
  await $query('Audit')
    .notEqualTo('data.changes', null)
    .select(['fn', 'itemId', 'data'])
    .each(async (audit) => {
      const data = cloneDeep(audit.get('data'))
      let changed = false
      for (const key of Object.keys(data.changes)) {
        const [before, after] = data.changes[key]
        if (before === after) {
          delete data.changes[key]
          changed = true
        }
      }
      if (changed) {
        if (!Object.keys(data.changes).length) {
          delete data.changes
        }
        if (preview) {
          consola.info(audit.get('fn'), audit.get('itemId'), audit.get('data'), data)
        } else {
          Object.keys(data).length
            ? await audit.set({ data }).save(null, { useMasterKey: true })
            : await audit.destroy({ useMasterKey: true })
        }
        i++
      }
    }, { useMasterKey: true })
  consola.info({ i })
  return i
}

require('./run')(() => cleanAudits())
