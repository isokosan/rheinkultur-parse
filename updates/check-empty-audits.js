// SHOULD RETURN 0 ERRORS -> if not, there are errors in code leading to empty audits

const { cloneDeep } = require('lodash')
async function cleanAudits (preview) {
  let c = 0
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
        c++
        if (preview) {
          return
        }
        Object.keys(data).length
          ? await audit.set({ data }).save(null, { useMasterKey: true })
          : await audit.destroy({ useMasterKey: true })
      }
    }, { useMasterKey: true })

  let r = 0
  await $query('Audit')
    .equalTo('data', null)
    .endsWith('fn', '-update')
    .select(['fn', 'itemId', 'data'])
    .each(async (audit) => {
      console.log(audit.get('fn'), audit.get('itemId'), audit.get('data'))
      if (!preview) {
        await audit.destroy({ useMasterKey: true })
      }
      r++
    }, { useMasterKey: true })
  console.info('DONE', { cleaned: c, removed: r })
}

require('./run')(() => cleanAudits(true))
