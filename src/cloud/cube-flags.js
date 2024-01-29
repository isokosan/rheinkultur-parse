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

const EXCLUDE_CITIES_PER_PARTNER = {
  XPLYKFS9Pc: [
    'NW:Remscheid',
    'NW:Solingen',
    'NW:Erkrath',
    'NW:Haan',
    'NW:Heiligenhaus',
    'NW:Hilden',
    'NW:Langenfeld',
    'NW:Mettmann',
    'NW:Monheim am Rhein',
    'NW:Ratingen',
    'NW:Velbert',
    'NW:Wülfrath'
  ]
}

const CUBE_FLAGS = {
  // NO RIGHTS
  MBfD: {
    value: 'MBfD',
    label: 'geförderter Standort (MBfD)',
    description: 'Standort durch Landesmittel finanziert. Werbliche Nutzung untersagt.',
    level: 'error',
    editable: true
  },
  bPLZ: {
    value: 'bPLZ',
    label: 'PLZ auf der Blacklist',
    level: 'error',
    lessors: ['TLK'],
    description: 'Vermarktungsrecht liegt nicht bei RMV. Angabe könnte falsch sein.',
    editable: false,
    disabled: true
  },
  SSgB: {
    value: 'SSgB',
    label: 'Ströer Stadtgebiet Berlin',
    level: 'error',
    lessors: ['TLK'],
    description: 'Vermarktungsrecht liegt bei Ströer.',
    editable: false,
    disabled: true
  },
  PDGA: {
    value: 'PDGA',
    label: 'PDG Aachen',
    level: 'error',
    lessors: ['TLK'],
    description: 'PDG ist der Vermarkter. Standorte vor Belegung PDG melden.: \n' + Object.keys(PDGA).map($parsePk).map(({ ort }) => ort).join(', '),
    editable: false,
    disabled: true
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
  SF: {
    value: 'SF',
    label: 'Sonderfall',
    description: 'Beispiele: Verfügung Stadt, Ornungsamt, Telekom Vertrag mit Stadt, etc. - Bitte Kommentarfeld beachten.',
    level: 'error',
    editable: true
  },

  Swnn: {
    value: 'Swnn',
    label: 'Standort werblich nicht nutzbar.',
    description: 'Beispiele: Standort in Hecke, unterirdisch, eingezäunt, etc. - Bitte Kommentarfeld beachten.',
    editable: true,
    level: 'error'
  },
  htNM: {
    value: 'htNM',
    label: 'Gehäusetyp nicht vermarktbar',
    description: 'Gehäusetyp ungeeignet für Werbezwecke. Eintrag manuell erfolgt.',
    level: 'error',
    editable: null,
    disabled: true
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
    lessors: ['TLK'],
    description: 'Nach Buchung sofort Meldung an TT, Rahmen muss von TT entfernt werden.',
    editable: true
  },
  SaeK: {
    value: 'SaeK',
    label: 'Steht in einem Kreisverkehr',
    level: 'warning',
    lessors: ['TLK'],
    description: 'CityCubes können ausschließlich von Kinetic gebucht werden.',
    editable: true
  }
}

module.exports = {
  PDGA,
  CUBE_FLAGS,
  EXCLUDE_CITIES_PER_PARTNER,
  editableFlagKeys: Object.keys(CUBE_FLAGS).filter(key => CUBE_FLAGS[key].editable),
  errorFlagKeys: Object.keys(CUBE_FLAGS).filter(key => CUBE_FLAGS[key].level === 'error'),
  warningFlagKeys: Object.keys(CUBE_FLAGS).filter(key => CUBE_FLAGS[key].level === 'warning')
}
