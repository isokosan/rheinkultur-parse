require('./run')(async () => {
  const kinetic = await $getOrFail('Company', 'FNFCxMgEEr')
  const regexes = {
    Q1: /^(?:\d{4}-(?:01|02|03)-([0-2]\d|3[01]))$/,
    Q2: /^(?:\d{4}-(?:04|05|06)-([0-2]\d|3[01]))$/,
    Q3: /^(?:\d{4}-(?:07|08|09)-([0-2]\d|3[01]))$/,
    Q4: /^(?:\d{4}-(?:10|11|12)-([0-2]\d|3[01]))$/
  }
  for (const quarter of ['Q1', 'Q2', 'Q3', 'Q4']) {
    const count = await $query('Contract')
      .equalTo('company', kinetic)
      .equalTo('status', 3)
      .matches('startsAt', regexes[quarter])
      .count({ useMasterKey: true })
    console.log(`Groupm contracts starting in ${quarter}: ${count}`)
  }
})
