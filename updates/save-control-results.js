// TOCHECK: SHOULD RETURN 0 EACH TIME
async function controlResults () {
  let l = 0
  await $query('TaskList')
    .equalTo('type', 'control')
    .greaterThan('status', 1)
    .equalTo('results', null)
    .eachBatch(async (batch) => {
      for (const list of batch) {
        await list.save(null, { useMasterKey: true })
        l++
      }
    }, { useMasterKey: true })
  console.log(l)
}

require('./run')(controlResults)
