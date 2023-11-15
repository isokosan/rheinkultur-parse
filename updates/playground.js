require('./run')(async () => {
  const parent = await $getOrFail('Control', 'CLS61nmVdJ')
  await parent.save(null, { useMasterKey: true, context: { syncStatus: true } })
  console.log('OK')
})
