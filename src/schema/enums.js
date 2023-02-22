const { camelCase } = require('lodash')

module.exports.ACC_TYPES = {
  admin: 'Administrator',
  intern: 'Benutzer',
  scoutManager: 'Scout Manager',
  scout: 'Scout',
  distributor: 'Vertriebspartner'
}
module.exports.DISTRIBUTOR_ROLES = {
  'manage-bookings': 'Manage Bookings',
  'manage-scouts': 'Manage Scouts'
}
module.exports.BOOKING_STATUSES = {
  '-1': 'Gelöscht',
  0.0: 'Entwurf', // distributors
  0.1: 'Genehmigung ausstehend', // distributors
  0.2: 'Abgelehnt', // distributors
  2: 'Entwurf',
  2.1: 'In Bearbeitung',
  3: 'Aktiv',
  4: 'Gekündigt',
  5: 'Ausgelaufen'
}
module.exports.CONTRACT_STATUSES = {
  '-1': 'Gelöscht',
  0.0: 'Entwurf', // offers
  0.1: 'Gesendet', // offers
  0.2: 'Abgelehnt', // offers ????
  0.3: 'Accepted', // offers ????
  2: 'Entwurf',
  2.1: 'In Bearbeitung',
  3: 'Aktiv',
  4: 'Gekündigt',
  5: 'Ausgelaufen'
}
module.exports.CUBE_STATUSES = {
  0: 'Verfügbar',
  5: 'Vermarktet',
  7: 'Nicht vermarktungsfähig',
  8: 'Nicht gefunden'
}
module.exports.INVOICE_STATUSES = {
  0: 'Entwurf',
  1: 'Geplant',
  2: 'Abgeschlossen',
  3: 'Storniert',
  4: 'Verworfen'
}
module.exports.PAYMENT_TYPES = {
  0: 'Überweisung',
  1: 'Lastschrift'
}
module.exports.BILLING_CYCLES = {
  1: 'Monat',
  3: 'Quartal',
  6: 'Halbjährlich',
  12: 'Jahr'
}
module.exports.CREDIT_NOTE_STATUSES = {
  0: 'Entwurf',
  1: 'Geplant',
  2: 'Abgeschlossen',
  3: 'Storniert',
  4: 'Verworfen'
}

const PRINT_PACKAGE_TYPES = {
  std: 'Standard-Format',
  alu: 'Alu Dibond',
  foil: 'Hochleistungs-Folie'
}
const PRINT_PACKAGE_FILES = []
for (const type in PRINT_PACKAGE_TYPES) {
  for (const face of ['front', 'side']) {
    PRINT_PACKAGE_FILES.push(camelCase([type, face, 'file'].join(' ')))
  }
}
module.exports.PRINT_PACKAGE_FILES = PRINT_PACKAGE_FILES
module.exports.PRINT_PACKAGE_TYPES = PRINT_PACKAGE_TYPES
module.exports.PRINT_PACKAGE_FACES = {
  front: 'Front',
  side: 'Seite',
  top: 'Deckel',
  back: 'Rückseite'
}

module.exports.INTEREST_RATES = {
  12: 5,
  24: 10,
  36: 15
}

module.exports.DEPARTURE_LIST_STATUSES = {
  0: 'Entwurf',
  appointed: 'Beauftragt',
  in_progress: 'In Bearbeitung',
  completed: 'Beendet'
}
