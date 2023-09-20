async function fix() {
  await $query('TaskList')
    .notEqualTo('briefing', null)
    .each(tl => tl.save(null, { useMasterKey: true }), { useMasterKey: true })
    .then(console.log)
}

require('./run')(fix)