const readPublic = {
  get: { '*': true },
  find: { '*': true },
  count: { '*': true }
}
const readAuthOnly = {
  get: { requiresAuthentication: true },
  find: { requiresAuthentication: true },
  count: { requiresAuthentication: true }
}
const writeAuthOnly = {
  create: { requiresAuthentication: true },
  update: { requiresAuthentication: true },
  delete: { requiresAuthentication: true }
}
const readMasterOnly = {
  get: {},
  find: {},
  count: {}
}

const writeMasterOnly = {
  create: {},
  update: {},
  delete: {}
}

const taskSubmissionFields = {
  lastSubmittedAt: { type: 'Date' },
  taskList: { type: 'Pointer', targetClass: 'TaskList', required: true },
  cube: { type: 'Pointer', targetClass: 'Cube', required: true },
  scout: { type: 'Pointer', targetClass: '_User', required: true },
  status: { type: 'String', required: true },
  comments: { type: 'String' },
  rejectionReason: { type: 'String' }
}

const durationFields = {
  startsAt: { type: 'String' },
  initialDuration: { type: 'Number' },
  endsAt: { type: 'String' },
  autoExtendsAt: { type: 'String' },
  autoExtendsBy: { type: 'Number', default: 12 },
  noticePeriod: { type: 'Number' },
  extendedDuration: { type: 'Number' }
}

const orderFields = {
  no: { type: 'String', required: true },
  status: { type: 'Number', required: true },
  company: { type: 'Pointer', targetClass: 'Company', required: true },
  companyPerson: { type: 'Pointer', targetClass: 'Person' },

  motive: { type: 'String' },
  externalOrderNo: { type: 'String' },
  campaignNo: { type: 'String' },

  ...durationFields,

  voidedAt: { type: 'Date' },
  canceledAt: { type: 'Date' },
  cancelNotes: { type: 'String' },

  cubeIds: { type: 'Array', default: [] },

  disassembly: { type: 'Object' }, // disassembly info

  // calculated
  cubeCount: { type: 'Number' },
  totalDuration: { type: 'Number' }
}

const orderIndexes = {
  noIndex: { no: 1 },
  cubeIdsIndex: { cubeIds: 1 },
  cubeIdsWithStatusIndex: { status: 1, cubeIds: 1 }
}

const schemaDefinitions = {
  _Role: {
    CLP: { ...readAuthOnly, ...writeMasterOnly }
  },
  _Session: {
    CLP: { ...readAuthOnly, ...writeMasterOnly }
  },
  _User: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      company: { type: 'Pointer', targetClass: 'Company' },
      prefix: { type: 'String' },
      firstName: { type: 'String', required: true },
      lastName: { type: 'String', required: true },
      email: { type: 'String', required: true },
      pbx: { type: 'String' },
      mobile: { type: 'String' },
      accType: { type: 'String', required: true },
      permissions: { type: 'Array' }
    }
  },
  ApiToken: {
    CLP: { ...readAuthOnly, ...writeAuthOnly },
    fields: {
      token: { type: 'String', required: true },
      company: { type: 'Pointer', targetClass: 'Company' } // required in before-save
    }
  },
  Cache: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      key: { type: 'String', required: true },
      value: { type: 'Object', required: true }
    }
  },
  CookieConsent: {
    CLP: {
      get: { '*': true },
      find: { '*': true },
      count: { '*': true },
      ...writeMasterOnly
    },
    fields: {
      uuid: { type: 'String', required: true },
      user: { type: 'Pointer', targetClass: '_User' },
      activity: { type: 'Object' }
    },
    indexes: {
      uuidIndex: { uuid: 1 }
    }
  },
  Address: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      company: { type: 'Pointer', targetClass: 'Company', required: true },
      lex: { type: 'Object' },
      name: { type: 'String', required: true },
      supplement: { type: 'String' },
      street: { type: 'String', required: true },
      zip: { type: 'String', required: true },
      city: { type: 'String', required: true },
      countryCode: { type: 'String', required: true, default: 'DE' },
      email: { type: 'String' },
      pbx: { type: 'String' }
    }
  },
  Audit: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      itemClass: { type: 'String', required: true },
      itemId: { type: 'String', required: true },
      user: { type: 'Pointer', targetClass: '_User' },
      fn: { type: 'String', required: true },
      data: { type: 'Object' }
    },
    indexes: {
      item: { itemClass: 1, itemId: 1 },
      user: { user: 1 }
    }
  },
  Booking: {
    CLP: {
      get: { '*': true },
      find: { requiresAuthentication: true },
      count: { requiresAuthentication: true },
      create: {},
      update: {},
      delete: {}
    },
    fields: {
      ...orderFields,
      cubeId: { type: 'String' },

      docs: { type: 'Array' },
      tags: { type: 'Array' },
      responsibles: { type: 'Array' },

      // stored
      cubeData: { type: 'Object' },

      // pricing comes from vertriebspartner
      endPrices: { type: 'Object' }, // Kunden-netto, only applies when company has commission pricing model
      monthlyMedia: { type: 'Object' }, // Monthly prices are set only when the company has no pricing model

      request: { type: 'Object' }, // VP requests
      requestHistory: { type: 'Array' } // VP request history
    },
    indexes: orderIndexes
  },
  Comment: {
    CLP: {
      get: { requiresAuthentication: true },
      find: { requiresAuthentication: true },
      count: { requiresAuthentication: true },
      create: {},
      update: {},
      delete: { requiresAuthentication: true }
    },
    fields: {
      createdBy: { type: 'Pointer', targetClass: '_User' },
      itemClass: { type: 'String', required: true },
      itemId: { type: 'String', required: true },
      text: { type: 'String', required: true },
      source: { type: 'String' }
    },
    indexes: {
      item: { itemClass: 1, itemId: 1 }
    }
  },
  Company: {
    CLP: {
      get: { '*': true },
      find: { requiresAuthentication: true },
      count: { requiresAuthentication: true },
      create: {},
      update: {},
      delete: {}
    },
    fields: {
      importNo: { type: 'Number' },
      deletedAt: { type: 'Date' }, // soft deletes

      name: { type: 'String', required: true },
      address: { type: 'Pointer', targetClass: 'Address' },
      invoiceAddress: { type: 'Pointer', targetClass: 'Address' },

      paymentType: { type: 'Number' },
      dueDays: { type: 'Number' },

      distributor: { type: 'Object' }, // DistributorOptions | null
      agency: { type: 'Object' }, // AgencyOptions or null
      lessor: { type: 'Object' }, // LessorOptions | null
      scoutor: { type: 'Object' }, // ScoutorOptions or null

      docs: { type: 'Array' },
      tags: { type: 'Array' },
      responsibles: { type: 'Array' }
    }
  },
  Contract: {
    CLP: {
      get: { '*': true },
      find: { requiresAuthentication: true },
      count: { requiresAuthentication: true },
      create: {},
      update: {},
      delete: {}
    },
    fields: {
      ...orderFields,
      earlyCancellations: { type: 'Object' },
      // freeExtensions: { type: 'Object' }, // to be used if we want to allow per contract free extensions
      selectionRatings: { type: 'Object' }, // used to store info on how good a selected cube is

      address: { type: 'Pointer', targetClass: 'Address', required: true },
      driveFileId: { type: 'String' }, // google doc id
      // billing & pricing
      invoiceAddress: { type: 'Pointer', targetClass: 'Address' },
      invoicingAt: { type: 'String', default: 'start' }, // start or end (default: start)
      billingCycle: { type: 'Number', required: true },
      paymentType: { type: 'Number' },
      dueDays: { type: 'Number' },
      pricingModel: { type: 'String' }, // gradual | zero | none
      gradualPriceMap: { type: 'Pointer', targetClass: 'GradualPriceMap' },
      skipInvoiceEmails: { type: 'Boolean' },
      invoiceDescription: { type: 'String' },
      // lateStart: { type: 'Object' }, // deprecated

      // agency
      agency: { type: 'Pointer', targetClass: 'Company' },
      agencyPerson: { type: 'Pointer', targetClass: 'Person' },
      commissions: { type: 'Object' },
      commission: { type: 'Number' },

      // when being generated from a briefing
      briefing: { type: 'Pointer', targetClass: 'Briefing' },

      docs: { type: 'Array' },
      tags: { type: 'Array' },
      responsibles: { type: 'Array' },

      // stored
      cubeData: { type: 'Object' }
    },
    indexes: orderIndexes
  },
  FrameMount: {
    CLP: {
      get: { requiresAuthentication: true },
      find: { requiresAuthentication: true },
      count: { requiresAuthentication: true },
      create: {},
      update: {},
      delete: {}
    },
    fields: {
      pk: { type: 'String', required: true }, // placekey
      company: { type: 'Pointer', targetClass: 'Company' },
      status: { type: 'Number', required: true }, // 2: inactive 2.1: in-bearbeitung 3: active/free 4: inactive
      reservedUntil: { type: 'String' }, // free date end

      planned: { type: 'Number' },
      cubeIds: { type: 'Array' }, // free cube ids
      stars: { type: 'Object' },
      selectionRatings: { type: 'Object' }, // used to store info on how good a selected cube is
      freedCount: { type: 'Number' },
      cubeCount: { type: 'Number' }, // mounted cube count
      // cubeHistory: { type: 'Object' }, // history of qty changes per cube
      fmCounts: { type: 'Object' }, // current frame situation
      fmDates: { type: 'Object' }, // mount-unmount dates (startsAt, endsAt)
      fmCount: { type: 'Number' }, // current frame count
      takedowns: { type: 'Object' },
      counts: { type: 'Object' }, // aggregate counts

      // audits will keep track of changes (of freed cubes, not of each frame mount)
      docs: { type: 'Array' },
      tags: { type: 'Array' },
      responsibles: { type: 'Array' },

      request: { type: 'Object' }, // requests
      requestHistory: { type: 'Array' } // request history
    }
  },
  // Sonderformate
  SpecialFormat: {
    CLP: {
      get: { '*': true },
      find: { requiresAuthentication: true },
      count: { requiresAuthentication: true },
      create: {},
      update: {},
      delete: {}
    },
    fields: {
      ...orderFields,
      earlyCancellations: { type: 'Object' },
      sfCounts: { type: 'Object' }, // how many were hung per cube
      sfCount: { type: 'Number' }, // total

      // when being generated from a special format briefing
      customService: { type: 'Pointer', targetClass: 'CustomService' }
    },
    indexes: orderIndexes
  },
  Cube: {
    CLP: { ...readPublic, ...writeMasterOnly },
    fields: {
      lc: { type: 'String', required: true }, // lessor code
      media: { type: 'String' }, // Media code
      ht: { type: 'Pointer', targetClass: 'HousingType' }, // HousingType
      gp: { type: 'GeoPoint', required: true }, // GeoPoint
      str: { type: 'String' }, // street
      hsnr: { type: 'String' }, // house number
      plz: { type: 'String' }, // postcode
      ort: { type: 'String', required: true }, // city - required was added later so not taking effect here
      state: { type: 'Pointer', targetClass: 'State', required: true }, // State - required was added later so not taking effect here

      pk: { type: 'String' }, // placekey

      caok: { type: 'String' }, // current active order key
      ffok: { type: 'String' }, // first future order key
      fmk: { type: 'String' }, // frame mount key
      order: { type: 'Object' }, // current order
      futureOrder: { type: 'Object' }, // first future order
      fm: { type: 'Object' }, // frame mount info
      vAt: { type: 'Date' }, // verifiedAt Date
      flags: { type: 'Array' },

      cAt: { type: 'Date' }, // lastControlledAt Date
      sAt: { type: 'Date' }, // lastScoutedAt Date

      dAt: { type: 'Date' }, // deletedAt Date (not found)
      pair: { type: 'Pointer', targetClass: 'Cube' }, // Cube pair, if filled this one will be hidden

      // photos
      p1: { type: 'Pointer', targetClass: 'CubePhoto' }, // Nauaufnahme
      p2: { type: 'Pointer', targetClass: 'CubePhoto' }, // Umfeld

      // belegung possibility
      sides: { type: 'Object' }, // Which sides (faces) can be used
      features: { type: 'Object' }, // extra scouting data (features)

      hti: { type: 'String' }, // housing type string from import
      importData: { type: 'Object' }, // Object
      legacyScoutResults: { type: 'Object' } // temporary scouting app results
    },
    indexes: {
      orderKeyIndex: { caok: 1 },
      futureOrderKeyIndex: { ffok: 1 },
      frameMountKey: { fmk: 1 },
      flagsIndex: { flags: 1 }
    }
  },
  CubePhoto: {
    CLP: {
      get: { '*': true },
      find: { '*': true },
      count: { '*': true },
      create: {},
      update: {},
      delete: { requiresAuthentication: true }
    },
    fields: {
      cubeId: { type: 'String', required: true },
      createdBy: { type: 'Pointer', targetClass: '_User' },
      approved: { type: 'Boolean' },
      file: { type: 'File', required: true },
      thumb: { type: 'File', required: true },
      size1000: { type: 'File' },
      original: { type: 'File' }, // carried from file if photo is edited
      scope: { type: 'String' } // prefix-B:bookingId | assembly-C:contractId
    },
    indexes: {
      cubeIdIndex: { cubeId: 1 },
      scopeIndex: { scope: 1 }
    }
  },
  CreditNote: {
    CLP: { ...readAuthOnly, ...writeAuthOnly },
    fields: {
      status: { type: 'Number', required: true },
      createdBy: { type: 'Pointer', targetClass: '_User' }, // to keep track of auto-generated credit notes
      date: { type: 'String', required: true },
      company: { type: 'Pointer', targetClass: 'Company', required: true },
      address: { type: 'Pointer', targetClass: 'Address', required: true },
      companyPerson: { type: 'Pointer', targetClass: 'Person' },
      contract: { type: 'Pointer', targetClass: 'Contract' },
      invoices: { type: 'Array' },
      reason: { type: 'String' }, // reason that will be added to introduction text
      mediaItems: { type: 'Object' }, // holds pacht relevant info from invoices
      introduction: { type: 'String' }, // introduction that will appear on lex office
      periodStart: { type: 'String' },
      periodEnd: { type: 'String' },

      // LEX
      lexNo: { type: 'String' },
      lexId: { type: 'String' },
      lexDocumentFileId: { type: 'String' },
      lexUri: { type: 'String' },
      voucherStatus: { type: 'String' },

      docs: { type: 'Array' },
      tags: { type: 'Array' },

      mailStatus: { type: 'Object' },
      postStatus: { type: 'Object' }
    }
  },
  FileObject: {
    CLP: { ...readAuthOnly, ...writeAuthOnly },
    fields: {
      name: { type: 'String', required: true },
      ext: { type: 'String' },
      assetType: { type: 'String' },
      contentType: { type: 'String' },
      file: { type: 'File' },
      fileSize: { type: 'Number' },
      thumb: { type: 'File' },
      createdBy: { type: 'Pointer', targetClass: '_User' }
    }
  },
  GradualPriceMap: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      code: { type: 'String', required: true },
      map: { type: 'Object', required: true }
    }
  },
  HousingType: {
    CLP: { ...readPublic, ...writeMasterOnly },
    fields: {
      media: { type: 'String', required: true },
      code: { type: 'String', required: true },
      stdFrontFile: { type: 'Pointer', targetClass: 'FileObject' },
      stdSideFile: { type: 'Pointer', targetClass: 'FileObject' },
      foilFrontFile: { type: 'Pointer', targetClass: 'FileObject' },
      foilSideFile: { type: 'Pointer', targetClass: 'FileObject' },
      aluFrontFile: { type: 'Pointer', targetClass: 'FileObject' },
      aluSideFile: { type: 'Pointer', targetClass: 'FileObject' }
    }
  },
  Invoice: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      status: { type: 'Number', required: true },
      date: { type: 'String', required: true },
      createdBy: { type: 'Pointer', targetClass: '_User' }, // to keep track of auto-generated invoices
      company: { type: 'Pointer', targetClass: 'Company' },
      address: { type: 'Pointer', targetClass: 'Address', required: true },
      companyPerson: { type: 'Pointer', targetClass: 'Person' },
      contract: { type: 'Pointer', targetClass: 'Contract' }, // filled only when a contract is invoiced
      booking: { type: 'Pointer', targetClass: 'Booking' }, // filled only when a single booking is invoiced for production
      introduction: { type: 'String' }, // introduction that will appear on lex office

      // LEX
      lexNo: { type: 'String' },
      lexId: { type: 'String' },
      lexDocumentFileId: { type: 'String' },
      lexUri: { type: 'String' },
      voucherStatus: { type: 'String' }, // lex office status

      // Payment
      paymentType: { type: 'Number' }, // PAYMENT_TYPES
      dueDays: { type: 'Number', required: true, default: 14 },

      media: { type: 'Object' },
      /*
        items: MediaCalculationItem[] {
          [cubeId]: {
            monthly: Number
            total: Number
            periodEnd?: String
            months: Number
            ...extraFields: [for exports]
          }
        }
        monthlyTotal
        total
       */
      periodStart: { type: 'String' },
      periodEnd: { type: 'String' },
      gradualPrice: { type: 'Number' }, // if media was calculated via gradual price save the calculated amount at date
      gradualCount: { type: 'Number' }, // if media was calculated via gradual price save the calculated no of cubes at date

      production: { type: 'Object' },
      /*
        items: PrintPackageItem{
          [cubeId]: {
            monthly: Number
            total: Number
          }
        }
        monthlyTotal
        total
       */

      agency: { type: 'Pointer', targetClass: 'Company' },
      commissionRate: { type: 'Number' },
      commission: { type: 'Object' },

      // lessor info
      lessor: { type: 'Pointer', targetClass: 'Company' },
      lessorRate: { type: 'Number' },

      /*
        net: Number // net total
        tax: Number // tax total
        gross: Number // gross total
       */

      // cached values
      // netTotal, taxTotal, total, alternative: total: { net, tax, gross }
      // cubeCount

      lineItems: { type: 'Array', required: true }, // required for lex office

      netTotal: { type: 'Number' },
      taxTotal: { type: 'Number' },
      total: { type: 'Number' },

      // for pacht exports
      extraCols: { type: 'Object' },

      docs: { type: 'Array' },
      tags: { type: 'Array' },

      mailStatus: { type: 'Object' },
      postStatus: { type: 'Object' },

      // for tracking duplications from canceled invoices
      duplicateOf: { type: 'Pointer', targetClass: 'Invoice' }
    }
  },
  Person: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      company: { type: 'Pointer', targetClass: 'Company' },
      prefix: { type: 'String', required: true },
      firstName: { type: 'String', required: true },
      lastName: { type: 'String', required: true },
      title: { type: 'String' },
      email: { type: 'String' },
      pbx: { type: 'String' },
      mobile: { type: 'String' }
    }
  },
  PrintPackage: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      no: { type: 'String', required: true },
      media: { type: 'String' }, // all if empty
      price: { type: 'Number' },
      faces: { type: 'Object' },
      // [side: Side]: count: Number
      // Side: 'front' | 'side' | 'top' | 'back'
      type: { type: 'String' } // material: 'std' | 'foil' | 'alu'
    }
  },
  Production: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      contract: { type: 'Pointer', targetClass: 'Contract' },
      booking: { type: 'Pointer', targetClass: 'Booking' },
      billing: { type: 'Number' }, // invoicing and installments combined into billing: null or 0 for no invoice, 1 for single payment, 12, 24 or 36 for installments
      printPackages: { type: 'Object' },
      interestRate: { type: 'Number' }, // interest rate applied
      prices: { type: 'Object' }, // price of the item
      extras: { type: 'Object' }, // extra costs
      totals: { type: 'Object' }, // total costs
      total: { type: 'Number' }, // all around total of the production
      monthlies: { type: 'Object' }, // only if installments
      // Assembly
      assembly: { type: 'Boolean' },
      dueDate: { type: 'String' }, // Erschließungstermin default contract/booking start (ab dem ...)
      printFilesDue: { type: 'String' }, // lieferung der druck daten (bis spätestens ...) - default one month before contract/booking start
      assembler: { type: 'String' }, // company that does the montage
      assemblyStart: { type: 'String' }, // montagebeginn - default one week before contract/booking start
      realizedDate: { type: 'String' }, // belegungstart: realized date when montage is completed (generate gutschein )
      printTemplates: { type: 'Object' }, // druckvorlagen
      printFiles: { type: 'Object' }, // druckdaten
      printNotes: { type: 'Object' } // hinweise
    }
  },
  QuarterlyReport: {
    CLP: { ...readMasterOnly, ...writeMasterOnly },
    fields: {
      quarter: { type: 'String', required: true }, // Q-YYYY
      status: { type: 'String' },
      rows: { type: 'Array' }, // holds all data
      // totals (summaries)
      rheinkultur: { type: 'Object' }, // Total
      customers: { type: 'Object' }, // Regular Contracts
      distributors: { type: 'Object' }, // Partner Quarters
      agencies: { type: 'Object' }, // Agencies
      regionals: { type: 'Object' }, // SKK, SKS
      lessors: { type: 'Object' } // TLK, TBS, etc
    }
  },
  PartnerQuarter: {
    CLP: { ...readMasterOnly, ...writeMasterOnly },
    fields: {
      company: { type: 'Pointer', targetClass: 'Company', required: true },
      quarter: { type: 'String', required: true }, // Q-YYYY
      status: { type: 'String' },
      rows: { type: 'Array' }, // holds all data
      // totals (summary)
      total: { type: 'Number' },
      count: { type: 'Number' }
    }
  },
  PLZ: {
    CLP: {
      get: { '*': true },
      find: { requiresAuthentication: true },
      count: { requiresAuthentication: true },
      create: {},
      update: {},
      delete: {}
    },
    fields: {
      nMR: { type: 'Boolean' },
      blk: { type: 'Array' },
      pks: { type: 'Array' },
      population: { type: 'Number' },
      qkm: { type: 'Number' }
    }
  },
  Media: {
    CLP: { ...readAuthOnly, ...writeMasterOnly }
  },
  Notification: {
    CLP: {
      ...readMasterOnly,
      ...writeMasterOnly,
      readUserFields: ['user']
    },
    fields: {
      user: { type: 'Pointer', targetClass: '_User', required: true },
      identifier: { type: 'String', required: true },
      data: { type: 'Object' },
      readAt: { type: 'Date' },
      sentAt: { type: 'Date' },
      push: { type: 'Object' },
      mail: { type: 'Object' }
    }
  },
  // SCOUTING
  Briefing: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      name: { type: 'String', required: true },
      company: { type: 'Pointer', targetClass: 'Company' },
      // companyPerson: { type: 'Pointer', targetClass: 'Person' },
      date: { type: 'String', required: true },
      dueDate: { type: 'String', required: true },
      status: { type: 'Number', required: true },

      responsibles: { type: 'Array' },
      docs: { type: 'Array' }
    }
  },
  Control: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      name: { type: 'String', required: true },
      date: { type: 'String', required: true },
      dueDate: { type: 'String', required: true },
      status: { type: 'Number', required: true },

      lastControlBefore: { type: 'Number' },
      orderType: { type: 'String' },
      criteria: { type: 'Array' },

      responsibles: { type: 'Array' },
      docs: { type: 'Array' }
    }
  },
  ControlReport: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      control: { type: 'Pointer', targetClass: 'Control', required: true },
      company: { type: 'Pointer', targetClass: 'Company', required: true },
      submissions: { type: 'Object' },
      status: { type: 'String' }
    }
  },
  // Assembly: {
  //   CLP: { ...readAuthOnly, ...writeMasterOnly },
  //   fields: {
  //     contract: { type: 'Pointer', targetClass: 'Contract' },
  //     booking: { type: 'Pointer', targetClass: 'Booking' },
  //     date: { type: 'String', required: true },
  //     dueDate: { type: 'String', required: true },
  //     status: { type: 'Number', required: true }
  //   }
  // },
  Disassembly: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      contract: { type: 'Pointer', targetClass: 'Contract' },
      booking: { type: 'Pointer', targetClass: 'Booking' },
      type: { type: 'String', required: true },
      date: { type: 'String', required: true },
      dueDate: { type: 'String', required: true },
      status: { type: 'Number', required: true }
    }
  },
  // This is custom fieldwork parent, where in the future we combine other types of fieldwork
  CustomService: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      type: { type: 'String' },
      name: { type: 'String', required: true },
      company: { type: 'Pointer', targetClass: 'Company' },
      // companyPerson: { type: 'Pointer', targetClass: 'Person' },
      date: { type: 'String', required: true },
      dueDate: { type: 'String', required: true },
      status: { type: 'Number', required: true },

      responsibles: { type: 'Array' },
      docs: { type: 'Array' }
    }
  },
  TaskList: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      type: { type: 'String', required: true }, // scout, control or disassembly
      briefing: { type: 'Pointer', targetClass: 'Briefing' },
      control: { type: 'Pointer', targetClass: 'Control' },
      disassembly: { type: 'Pointer', targetClass: 'Disassembly' },
      customService: { type: 'Pointer', targetClass: 'CustomService' },
      ort: { type: 'String' },
      state: { type: 'Pointer', targetClass: 'State' },

      pk: { type: 'String' }, // placekey

      gp: { type: 'GeoPoint' }, // GeoPoint
      date: { type: 'String', required: true }, // start date
      dueDate: { type: 'String', required: true },
      manager: { type: 'Pointer', targetClass: '_User' },
      scouts: { type: 'Array' },
      status: { type: 'Number', required: true },
      cubeIds: { type: 'Array', default: [] },
      cubeCount: { type: 'Number', default: 0 },
      selectionRatings: { type: 'Object' }, // used to store info on how good a selected cube is

      // only for scout and parent briefing
      scoutAddedCubeIds: { type: 'Array' }, // // case for briefings when scout adds extra cube (briefings)
      markedDisassembledCubeIds: { type: 'Array' }, // case for controls when admin marks a cube disassembled
      adminApprovedCubeIds: { type: 'Array' }, // case when admin marks as approved (skipped) (for all)

      quota: { type: 'Number' }, // single quota
      quotas: { type: 'Object' }, // media based quota

      // calculated
      counts: { type: 'Object' },
      statuses: { type: 'Object' },
      quotasCompleted: { type: 'Object' } // only for parent briefing
    }
  },
  ScoutSubmission: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      ...taskSubmissionFields,
      condition: { type: 'String' },
      form: { type: 'Object' },
      photos: { type: 'Array' }
    }
  },
  ControlSubmission: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      ...taskSubmissionFields,
      condition: { type: 'String' },
      orderKey: { type: 'String' }, // order key
      // photos are via scope in CubePhotos
      beforePhotos: { type: 'Array' },
      afterPhotos: { type: 'Array' },
      disassembly: { type: 'Pointer', targetClass: 'DisassemblySubmission' }
    }
  },
  AssemblySubmission: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      ...taskSubmissionFields
    }
  },
  DisassemblySubmission: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      ...taskSubmissionFields,
      condition: { type: 'String' },
      photos: { type: 'Array' }
    }
  },
  SpecialFormatSubmission: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      ...taskSubmissionFields,
      quantity: { type: 'Number' },
      form: { type: 'Object' },
      photos: { type: 'Array' }
    }
  },
  // TODO: Remove the following in favor of using a better system?
  City: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      ort: { type: 'String', required: true }, // required was added later so not taking effect here
      state: { type: 'Pointer', targetClass: 'State', required: true }, // required was added later so not taking effect here
      gp: { type: 'GeoPoint' }
    }
  },
  State: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      name: { type: 'String', required: true }
    }
  },
  Tag: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      name: { type: 'String', required: true } // required was added later so not taking effect here
    }
  },
  UnsyncedLexDocument: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      type: { type: 'String', required: true },
      lexId: { type: 'String', required: true },
      resource: { type: 'Object' }
    }
  }
}

// export interface JSONSchema {
//   className: ClassNameType;
//   fields?: { [key: string]: FieldType };
//   indexes?: IndexesInterface;
//   classLevelPermissions?: {
//     find?: CLPValue,
//     count?: CLPValue,
//     get?: CLPValue,
//     update?: CLPValue,
//     create?: CLPValue,
//     delete?: CLPValue,
//     addField?: CLPValue,
//     protectedFields?: ProtectedFieldsInterface,
//   };
// }

const definitions = []
for (const className of Object.keys(schemaDefinitions)) {
  const { CLP: classLevelPermissions, fields, indexes } = schemaDefinitions[className]
  definitions.push({
    className,
    indexes,
    classLevelPermissions,
    fields
  })
}

// export interface SchemaOptions {
//   definitions: JSONSchema[];
//   strict: ?boolean;
//   deleteExtraFields: ?boolean;
//   recreateModifiedFields: ?boolean;
//   lockSchemas: ?boolean;
//   beforeMigration: ?() => void | Promise<void>;
//   afterMigration: ?() => void | Promise<void>;
// }

module.exports = {
  definitions,
  // If set to `true`, the Parse Server API for schema changes is disabled and schema
  // changes are only possible by redeployingParse Server with a new schema definition
  // lockSchemas: true,
  // If set to `true`, Parse Server will automatically delete non-defined classes from
  // the database; internal classes like `User` or `Role` are never deleted.
  strict: true
  // If set to `true`, a field type change will cause the field including its data to be
  // deleted from the database, and then a new field to be created with the new type
  // recreateModifiedFields: false,
  // If set to `true`, Parse Server will automatically delete non-defined class fields;
  // internal fields in classes like User or Role are never deleted.
  // deleteExtraFields: false
}
