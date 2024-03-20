const { camelCase } = require('lodash')

module.exports.ACC_TYPES = {
  admin: 'Administrator',
  intern: 'Intern Benutzer',
  scout: 'Scout',
  partner: 'Vertriebspartner'
}

module.exports.PERMISSIONS = {
  'manage-bookings': 'Manage Bookings',
  'manage-scouts': 'Manage Scouts',
  'manage-fieldwork': 'Manage Fieldwork',
  'manage-frames': 'Manage Frames'
  /*
  cubes: 'CityCubes Public View', // verfügbar / nicht verfügbar
  'cubes-detail': 'CityCubes Detail View', // details like booked, not marketable etc
  'view-orders': 'Verträge und Buchungen einsehen', // View order details, when clicking on a cube, see which order
  'manage-orders': 'Verträge und Buchungen verwalten', // Create, edit, delete etc
  'view-vouchers': 'Rechnungen und Gutschriften einsehen',  // View voucher details
  'manage-vouchers': 'Rechnungen und Gutschriften verwalten', // Create, edit, delete etc
  'view-companies': 'Unternehmen einsehen',
  'manage-companies': 'Unternehmen verwalten',
  'view-products': 'Produkte einsehen',
  'manage-products': 'Produkte verwalten',
  'view-mobile-tasks': 'Mobile Aufgaben einsehen',
  'manage-mobile-tasks': 'Mobile Aufgaben verwalten',
  'manage-scouts': 'Scouts ',
  'scout': 'Scout',
  'control': 'Kontrol',
  'assembly': 'Montage',
  'disassembly': 'Demontage'
  */
}

module.exports.ORDER_STATUSES = {
  '-1': 'Storniert',
  0: 'Entwurf',
  // 0.0: 'Entwurf', // offers
  // 0.1: 'Gesendet', // offers
  // 0.2: 'Abgelehnt', // offers ????
  // 0.3: 'Accepted', // offers ????
  2: 'Entwurf',
  2.1: 'In Bearbeitung',
  3: 'Aktiv',
  4: 'Gekündigt', // should be combined into "Inaktiv"
  5: 'Ausgelaufen'
}

module.exports.BOOKING_REQUEST_TYPES = {
  create: 'Neue Buchung',
  change: 'Buchungsänderung',
  cancel: 'Kündigung',
  'cancel-change': 'Kündigung Korrektur',
  'cancel-cancel': 'Kündigung Widerruf',
  extend: 'Verlängerung',
  void: 'Stornierung'
}

module.exports.BOOKING_REQUEST_STATUSES = {
  0: 'Warten auf Freigabe',
  1: 'Genehmigt',
  2: 'Abgelehnt'
}

module.exports.FRAME_MOUNT_REQUEST_STATUSES = {
  draft: 'Entwurf',
  pending: 'Warten auf Freigabe',
  accepted: 'Genehmigt',
  rejected: 'Abgelehnt'
}

// When making changes to cube statuses, make sure to go over search and cube after find functions where public / partner statuses are set
module.exports.CUBE_STATUSES = {
  0: 'Verfügbar',
  // 3: 'Warnmeldung',
  4: 'Sonderformate',
  // Everything above here is "unverfügbar" in public view
  5: 'Moskitorahmen',
  6: 'Vermarktet',
  7: 'Nicht vermarktungsfähig',
  // Everything above here is invisible in public view
  8: 'Nicht gefunden',
  9: 'Ausgeblendet (A/R)'
}
module.exports.CREDIT_NOTE_STATUSES = {
  0: 'Entwurf',
  1: 'Geplant',
  1.5: 'Wird ausgestellt',
  2: 'Abgeschlossen',
  3: 'Storniert',
  4: 'Verworfen'
}
module.exports.INVOICE_STATUSES = {
  0: 'Entwurf',
  1: 'Geplant',
  1.5: 'Wird ausgestellt',
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

module.exports.TASK_LIST_STATUSES = {
  0: 'Entwurf',
  0.1: 'Geplant',
  1: 'Ernannt',
  2: 'Beauftragt',
  3: 'In Bearbeitung',
  4: 'Erledigt',
  4.1: 'Erledigt'
}

module.exports.TASK_LIST_IN_PROGRESS_STATUSES = [2, 3]

// Briefing, Control, Disassembly, CustomService
module.exports.FIELDWORK_STATUSES = {
  0: 'Entwurf',
  1: 'Geplant',
  2: 'Vorbereitet',
  3: 'In Bearbeitung',
  4: 'Erledigt',
  5: 'Archiviert'
}

module.exports.CUBE_FEATURES = {
  obstructionLevel: {
    label: 'Sichtbarkeit',
    values: {
      unobscured: 'Dauerhaft sichtbar',
      partly: 'Eingeschränkt sichtbar',
      concealed: 'Schlecht sichtbar'
    }
  },
  angleToTraffic: {
    label: 'Position zur Verkersachse',
    values: {
      perpendicular: 'Quer zur Fahrbahn',
      diagonal: 'Leicht quer zur Fahrbahn',
      parallel: 'Parallel zur Fahrbahn'
    }
  },
  nearTrafficLights: {
    label: 'Ampelnähe',
    values: {
      y: 'In Ampelnähe',
      n: 'Nicht in Ampelnähe'
    }
  }
}
