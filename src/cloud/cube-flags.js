// TOLATER: Save this in database and make editable
const PDGA = {
  'NW:Aachen': true,
  'NW:Alsdorf': true,
  'NW:Baesweiler': true,
  'NW:Eschweiler': true,
  'NW:Herzogenrath': true,
  'NW:Monschau': true,
  'NW:Roetgen': true,
  'NW:Simmerath': true,
  'NW:Stolberg (Rhld.)': true,
  'NW:Würselen': true
}
const CUBE_FLAGS = {
  // NO RIGHTS
  MBfD: {
    value: 'MBfD',
    label: 'geförderter Standort (MBfD)',
    level: 'error',
    editable: true
  },
  bPLZ: {
    value: 'bPLZ',
    label: 'PLZ auf der Blacklist',
    level: 'error',
    editable: false
  },
  SSgB: {
    value: 'SSgB',
    label: 'Ströer Stadtgebiet Berlin',
    level: 'error',
    lessors: ['TLK'],
    description: 'CityCubes from TLK can only be marketed to Kinetic.'
  },
  PG: {
    value: 'PG',
    label: 'Privates Grundstück',
    level: 'error',
    editable: true
  },
  DS: {
    value: 'DS',
    label: 'Denkmalgeschutz',
    level: 'error',
    editable: true
  },
  Agwb: {
    value: 'Agwb',
    label: 'Malaktion (Aus grau wird bunt)',
    level: 'error',
    editable: true
  },
  // WORK IN PROGRESS
  // kVr: {
  //   value: 'kVr',
  //   label: 'kein Vermarktungsrecht',
  //   level: 'error',
  //   editable: true
  // },
  // NOT MARKETABLE
  htNM: {
    value: 'htNM',
    label: 'Gehäusetyp nicht vermarktbar',
    level: 'error'
  },
  SagO: {
    value: 'SagO',
    label: 'Standort außerhalb geschlossener Ortschaft',
    level: 'error',
    editable: true
  },

  // WARNINGS
  TTMR: {
    value: 'TTMR',
    label: 'Moskito Rahmen (Town Talker)',
    level: 'warning',
    editable: true,
    description: 'Moskito Rahmen need to be removed from a CityCube before it can be marketed.'
  },
  PDGA: {
    value: 'PDGA',
    label: 'PDG Aachen',
    level: 'warning',
    description: 'CityCubes in the following territories should be first consulted: \n' + Object.keys(PDGA).map($parsePk).map(({ ort }) => ort).join('\n')
  },
  SaeK: {
    value: 'SaeK',
    label: 'Steht auf einem Kreisverkehr',
    level: 'warning',
    editable: true,
    description: 'CityCubes from TLK can only be marketed to Kinetic.'
  }
}

module.exports = {
  PDGA,
  CUBE_FLAGS,
  editableFlagKeys: Object.keys(CUBE_FLAGS).filter(key => CUBE_FLAGS[key].editable),
  errorFlagKeys: Object.keys(CUBE_FLAGS).filter(key => CUBE_FLAGS[key].level === 'error'),
  warningFlagKeys: Object.keys(CUBE_FLAGS).filter(key => CUBE_FLAGS[key].level === 'warning')
}
