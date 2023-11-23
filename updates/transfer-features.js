const LEGACY_KEYS = {
  obstructionLevel: 'Verdecktheit Fläche (=Stelle)',
  nearTrafficLights: 'Ampelsituation',
  angleToTraffic: 'Position zur Verkehrsachse'
}

const LEGACY_ANSWERS = {
  obstructionLevel: {
    'nahezu vollständig verdeckt (über 75% der Fläche)': 'concealed',
    'teilweise verdeckt (20% - 75% der Fläche)': 'partly',
    'unverdeckt / geringfügig verdeckt (0% - 19% der Fläche) ': 'unobscured'
  },
  nearTrafficLights: {
    'Schaltkasten steht in Ampelnähe (max. 20 Meter; Wartebereich der Ampel)': 'y',
    'Schaltkasten steht nicht in Ampelnähe': 'n'
  },
  angleToTraffic: {
    'Leicht quer zur Fahrbahn (15-45°)': 'diagonal',
    'Parallel zur Fahrbahn (0° - 14°)': 'parallel',
    'Quer zur Fahrbahn (46°-90°)': 'perpendicular'
  }
}

async function check () {
  const query = $query('Cube')
    .notEqualTo(`legacyScoutResults.${LEGACY_KEYS.angleToTraffic}`, null)
    .equalTo('features.angleToTraffic', null)
  await query.count({ useMasterKey: true }).then(console.log)
  return query.eachBatch(async (batch) => {
    for (const cube of batch) {
      const legacyScoutResults = cube.get('legacyScoutResults') || {}
      const features = cube.get('features') || {}
      features.angleToTraffic = LEGACY_ANSWERS.angleToTraffic[legacyScoutResults[LEGACY_KEYS.angleToTraffic]]
      features.nearTrafficLights = LEGACY_ANSWERS.nearTrafficLights[legacyScoutResults[LEGACY_KEYS.nearTrafficLights]]
      features.obstructionLevel = LEGACY_ANSWERS.obstructionLevel[legacyScoutResults[LEGACY_KEYS.obstructionLevel]]
      cube.set('features', features)
      await $saveWithEncode(cube, null, { useMasterKey: true, context: { updating: true } })
      console.log(cube.id)
    }
    console.log(`Updated ${batch.length} cubes`)
  }, { useMasterKey: true })
}

require('./run')(() => check())

// // Sichtbarkeit
// const OBSTRUCTION_LEVELS = {
//   unobscured: 'Dauerhaft sichtbar',
//   partly: 'Eingeschränkt sichtbar',
//   concealed: 'Schlecht sichtbar'
// }
// // Position zur Verkersachse
// const ANGLES_TO_TRAFFIC = {
//   perpendicular: 'Quer zur Fahrbahn',
//   diagonal: 'Leicht quer zur Fahrbahn',
//   parallel: 'Parallel zur Fahrbahn'
// }
// // Ampelnähe
// const TRAFFIC_LIGHTS = {
//   y: 'In Ampelnähe',
//   n: 'Nicht in Ampelnähe'
// }
