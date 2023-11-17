require('./run')(async () => {
  const nmrs = await $query('Cube').notEqualTo('nMR', null).count({ useMasterKey: true })
  if (!nmrs.length) {
    const schema = new Parse.Schema('Cube')
    console.log(schema.fields)
    const fieldKeys = await schema.get({ useMasterKey: true })
      .then(schema => Object.keys(schema.fields))
    const deletedFields = []
    for (const key of ['nMR', 'MBfD', 'bPLZ', 'SSgB', 'PDGA', 'PG', 'DS', 'Agwb', 'SF', 'Swnn', 'htNM', 'SagO', 'TTMR', 'SaeK']) {
      if (fieldKeys.includes(key)) {
        deletedFields.push(key)
        schema.deleteField(key)
      }
    }
    await schema.update({ useMasterKey: true })
    console.log('Deleted', deletedFields)
  }
})
