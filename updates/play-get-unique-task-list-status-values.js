require('./run')(async () => {
  const unique = []
  await $query('TaskList').select(['statuses']).eachBatch(async (batch) => {
    for (const item of batch) {
      const array = [...new Set(Object.values(item.get('statuses')))]
      for (const status of array) {
        if (!unique.includes(status)) {
          unique.push(status)
        }
      }
    }
  }, { useMasterKey: true, batchSize: 1000 })
  console.log(unique)
})
