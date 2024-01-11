require('./run')(async () => {
  await $query('CubePhoto').startsWith('scope', 'assembly-').count({ useMasterKey: true }).then(console.log)
})
