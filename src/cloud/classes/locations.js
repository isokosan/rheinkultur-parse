// global.$states = {
//   NI: 'Niedersachsen',
//   BW: 'Baden-Württemberg',
//   SH: 'Schleswig-Holstein',
//   BY: 'Bayern',
//   SL: 'Saarland',
//   HB: 'Bremen',
//   MV: 'Mecklenburg-Vorpommern',
//   HE: 'Hessen',
//   TH: 'Thüringen',
//   RP: 'Rheinland-Pfalz',
//   ST: 'Sachsen-Anhalt',
//   HH: 'Hamburg',
//   NW: 'Nordrhein-Westfalen',
//   SN: 'Sachsen',
//   BB: 'Brandenburg',
//   BE: 'Berlin'
// }

// TEMPORARY SOLUTION FOR CITIES AND STATES
Parse.Cloud.afterFind('City', ({ objects: cities }) => {
  for (const city of cities) {
    // TODO: Remove (open issue -> js sdk does not encodeURI so some chars in ID throw errors, whereas rest api works)
    city.id = encodeURI(city.id)
  }
})
