const dict = {
  'Ströer Stadtgebiet Berlin': 'SSgB',

  'PDG Aachen (Moskitorahmen)': 'TTMR',

  'Außerhalb geschlossener Ortschaft': 'SagO',
  'Außerhalb geschlossener Ortschaft!': 'SagO',
  'Standort außerhalb geschlossener Ortschaften': 'SagO',
  'außerhalb geschlossener Ortschaft': 'SagO',

  // DENKMALSCHUTZ: we make a new reason
  'reines Wohngebiet - Denkmalschutz': 'DS',
  Denkmalschutz: 'DS',
  'Denkmalschutz !!': 'DS',
  'möglicher Denkmalgeschützter Bereich!': 'DS', // http://localhost:8080/cubes/list?id=96612A46#cube=TLK-96612A46

  // PRIVATES GRUNDSTUCK
  'Eingezäunter Kasten auf Privatgrundstück!': 'PG',
  'steht auf Privatgrundstück': 'PG',
  'Steht auf Privatgrundstück': 'PG',
  'Steht auf Privatgrundstück!': 'PG',

  // GEHAUSETYP NICHT VERMARKBARG
  'Cube ist zu klein.': 'htNM',
  'Cube zu klein': 'htNM',
  'Cube zu klein.': 'htNM',
  'Cube-Typ nicht zu belegen.': 'htNM',
  'Gehäusetyp nicht belegbar.': 'htNM',
  'Kasten nicht belegbar.': 'htNM',
  'Werbefläche zu klein': 'htNM',

  // SHOULD BE MARKED NOT FOUND
  'Kasten nicht auffindbar': 'dAt',
  'Nicht auffindbar': 'dAt',

  // KASTEN NICHT BELEGBAR / NUTZBAR? should we make a new reason?
  'Standortqualität nicht empfehlenswert!': '',
  'Werblich nicht nutzbar!': '',
  'Kasten ist eingezäunt': '',
  'Nicht belegbar': '',

  // NICHT EINSEHBAR ?
  'Cube ist nicht einsehbar.': 'concealed', // SHOULD BE MARKED FEATURE: visibility bad
  'Cube nicht einsehbar': 'concealed', // SHOULD BE MARKED FEATURE: visibility bad
  'Cube nicht einsehbar.': 'concealed', // SHOULD BE MARKED FEATURE: visibility bad
  'Nicht einsehbar': 'concealed', // SHOULD BE MARKED FEATURE: visibility bad

  // WHAT IS THIS?
  KVZ92: '', // ???

  // NO REASON
  'Anlage ist nicht vermarktungsfähig': 'nMR',
  'Anlage nicht vermarktungsfähig': 'nMR',

  // CUSTOM REASON
  'Anlage ist nicht vermarktungsfähig (Beschwerde Ordnungsamt)': 'nMR',
  'Standort soll seitens der Telekom aus der werblichen Vermarktung genommen werden': 'nMR',
  'nicht vermarktungsfähig (Beschwerde Ordnungsamt)': 'nMR',
  'Bei der Telekom unter der Hs-Nr. 29 verzeichnet // Martina Simhardt 07.03.22': 'nMR',
  'Beseitigungsforderung der Stadt Lübeck von dem 09.08.2022': 'nMR',
  'lt. Telekom Standort der Stadt': 'nMR',
  'Cube steht an der Landstraße': 'nMR',
  '06/04/22: Stadt Espelkamp hat Werberecht': 'nMR',
  'Dez. 2021: Befindet sich lt. Telekom-Mitarbeiter an der Freiherr-vom-Stein Str. 1 ggü': 'nMR',
  'Keine Anlage der Telekom!!! Gehört der DOKOM Gesellschaft für Telekommunikation mbH': 'nMR'
}

require('./run')(async () => {
  const boolKeys = [
    'MBfD',
    'bPLZ',
    'SSgB',
    'PG',
    'DS',
    'Agwb',
    // nMR
    'htNM',
    'SagO',
    // warnings
    'TTMR',
    'PDGA',
    'SaeK'
  ]
  const pendingBoolsQuery = Parse.Query.or(...boolKeys.map(key => $query('Cube').equalTo(key, true)))
    .equalTo('flags', null)
  const remaining = await pendingBoolsQuery.count({ useMasterKey: true })
  let i = 0
  await pendingBoolsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      cube.set('flags', boolKeys.filter(key => cube.get(key)))
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      i++
    }
    console.log('transitioned', i, 'bools out of', remaining)
  }, { useMasterKey: true })
  console.log('DONE BOOLS')

  const pendingStrsQuery = $query('Cube').notEqualTo('nMR', null)
  // await pendingStrsQuery.distinct('nMR', { useMasterKey: true }).then(console.log)
  const pendingCount = await pendingStrsQuery.count({ useMasterKey: true })
  console.log('nMRs to transition:', pendingCount)
  console.log(await pendingStrsQuery.select('nMR').find({ useMasterKey: true }).then(cubes => cubes.reduce((dict, cube) => {
    dict[cube.id] = cube.get('nMR')
    return dict
  }, {})))

  // htNMs
  let htNMsCount = 0
  const htNMs = Object.keys(dict).filter(key => dict[key] === 'htNM')
  const htNMsQuery = $query('Cube').containedIn('nMR', htNMs)
  await htNMsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      if (cube.get('ht')) { throw new Error('htNM with ht') }
      const flags = cube.get('flags') || []
      flags.push('htNM')
      cube.set('flags', flags).unset('nMR')
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      htNMsCount++
    }
  }, { useMasterKey: true })
  console.log('DONE htNMs, count:', htNMsCount)

  // PGs
  let PGsCount = 0
  const PGs = Object.keys(dict).filter(key => dict[key] === 'PG')
  const PGsQuery = $query('Cube').containedIn('nMR', PGs)
  await PGsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const flags = cube.get('flags') || []
      flags.push('PG')
      cube.set('flags', flags).unset('nMR')
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      PGsCount++
    }
  }, { useMasterKey: true })
  console.log('DONE PGs, count:', PGsCount)

  // DSs
  let DSsCount = 0
  const DSs = Object.keys(dict).filter(key => dict[key] === 'DS')
  const DSsQuery = $query('Cube').containedIn('nMR', DSs)
  await DSsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const flags = cube.get('flags') || []
      flags.push('DS')
      cube.set('flags', flags).unset('nMR')
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      DSsCount++
    }
  }, { useMasterKey: true })
  console.log('DONE DSs, count:', DSsCount)

  // SagOs
  let SagOsCount = 0
  const SagOs = Object.keys(dict).filter(key => dict[key] === 'SagO')
  const SagOsQuery = $query('Cube').containedIn('nMR', SagOs)
  await SagOsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const flags = cube.get('flags') || []
      flags.push('SagO')
      cube.set('flags', flags).unset('nMR')
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      SagOsCount++
    }
  }, { useMasterKey: true })
  console.log('DONE SagOs, count:', SagOsCount)

  // TTMRs
  let TTMRsCount = 0
  const TTMRs = Object.keys(dict).filter(key => dict[key] === 'TTMR')
  const TTMRsQuery = $query('Cube').containedIn('nMR', TTMRs)
  await TTMRsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const flags = cube.get('flags') || []
      flags.push('TTMR')
      cube.set('flags', flags).unset('nMR')
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      TTMRsCount++
    }
  }, { useMasterKey: true })
  console.log('DONE TTMRs, count:', TTMRsCount)

  // SSgB
  let SSgBsCount = 0
  const SSgBs = Object.keys(dict).filter(key => dict[key] === 'SSgB')
  const SSgBsQuery = $query('Cube').containedIn('nMR', SSgBs)
  await SSgBsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const flags = cube.get('flags') || []
      flags.push('SSgB')
      cube.set('flags', flags).unset('nMR')
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      SSgBsCount++
    }
  }, { useMasterKey: true })
  console.log('DONE SSgBs, count:', SSgBsCount)

  // NOT FOUND
  let dAtCount = 0
  const dAts = Object.keys(dict).filter(key => dict[key] === 'dAt')
  const dAtsQuery = $query('Cube').containedIn('nMR', dAts)
  await dAtsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      cube.set({ dAt: new Date() }).unset('nMR').unset('vAt')
      // delete verification audits
      await $query('Audit')
        .equalTo('itemId', cube.id)
        .equalTo('itemClass', 'Cube')
        .containedIn('fn', ['cube-verify', 'cube-undo-verify'])
        .each(audit => audit.destroy({ useMasterKey: true }), { useMasterKey: true })
      const audit = { fn: 'cube-hide' }
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
      dAtCount++
    }
  }, { useMasterKey: true })
  console.log('DONE dAts, count:', dAtCount)

  // concealed
  let concealedCount = 0
  const concealeds = Object.keys(dict).filter(key => dict[key] === 'concealed')
  const concealedsQuery = $query('Cube').containedIn('nMR', concealeds).equalTo('scoutData.obstructionLevel', null)
  await concealedsQuery.eachBatch(async (cubes) => {
    for (const cube of cubes) {
      const scoutData = cube.get('scoutData') || {}
      scoutData.obstructionLevel = 'concealed'
      cube.set({ scoutData }).unset('nMR')
      await $saveWithEncode(cube, null, { useMasterKey: true })
      concealedCount++
    }
  }, { useMasterKey: true })
  console.log('DONE concealeds, count:', concealedCount)

  // The rest of the reasons we want to save as comments and mark as kVR
  // const rest = Object.keys(dict).filter(key => !key)
})
