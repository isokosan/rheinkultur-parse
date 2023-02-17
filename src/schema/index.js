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
const writeMasterOnly = {
  create: {},
  update: {},
  delete: {}
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
      distributorRoles: { type: 'Array' }
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
      fn: { type: 'String', required: true }, // which cloud function triggered this audit
      data: { type: 'Object' }
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
      no: { type: 'String', required: true },
      status: { type: 'Number', required: true },
      company: { type: 'Pointer', targetClass: 'Company' },
      companyPerson: { type: 'Pointer', targetClass: 'Person' },

      motive: { type: 'String' },
      externalOrderNo: { type: 'String' },
      campaignNo: { type: 'String' },

      // duration settings
      startsAt: { type: 'String' },
      initialDuration: { type: 'Number' },
      endsAt: { type: 'String' },
      autoExtendsAt: { type: 'String' },
      autoExtendsBy: { type: 'Number', default: 12 },
      noticePeriod: { type: 'Number' },
      extendedDuration: { type: 'Number' },
      earlyCancellations: { type: 'Object' },

      cubeIds: { type: 'Array', default: [] },

      disassembly: { type: 'Boolean' }, // demontage von Rheinkultur

      docs: { type: 'Array' },
      tags: { type: 'Array' },
      responsibles: { type: 'Array' },

      // calculated
      cubeCount: { type: 'Number' },
      totalDuration: { type: 'Number' },

      // pricing comes from vertriebspartner
      endPrices: { type: 'Object' }, // Kunden-netto, only applies when company has commission pricing model
      monthlyMedia: { type: 'Object' } // Monthly prices are set only when the company has no pricing model
    }
  },
  Briefing: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      name: { type: 'String', required: true },
      company: { type: 'Pointer', targetClass: 'Company' },
      companyPerson: { type: 'Pointer', targetClass: 'Person' },

      docs: { type: 'Array' },
      responsibles: { type: 'Array' }
    }
  },
  Control: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      name: { type: 'String', required: true },
      date: { type: 'String', required: true },
      lastControlBefore: { type: 'Number' },
      status: { type: 'Number' },

      criteria: { type: 'Array' },

      docs: { type: 'Array' },
      responsibles: { type: 'Array' }
    }
  },
  Disassembly: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      name: { type: 'String', required: true },

      docs: { type: 'Array' },
      responsibles: { type: 'Array' }
    }
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
      itemClass: { type: 'String', required: true },
      itemId: { type: 'String', required: true },
      text: { type: 'String', required: true },
      source: { type: 'String' }
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
      no: { type: 'String', required: true },
      status: { type: 'Number', required: true },
      company: { type: 'Pointer', targetClass: 'Company', required: true },
      companyPerson: { type: 'Pointer', targetClass: 'Person' },

      motive: { type: 'String' },
      externalOrderNo: { type: 'String' },
      campaignNo: { type: 'String' },

      // duration settings
      startsAt: { type: 'String' },
      initialDuration: { type: 'Number' },
      endsAt: { type: 'String' },
      autoExtendsAt: { type: 'String' },
      autoExtendsBy: { type: 'Number', default: 12 },
      noticePeriod: { type: 'Number' },
      extendedDuration: { type: 'Number' },
      earlyCancellations: { type: 'Object' },

      cubeIds: { type: 'Array', default: [] },

      // contract specific
      address: { type: 'Pointer', targetClass: 'Address', required: true },
      driveFileId: { type: 'String' }, // google doc id
      canceledAt: { type: 'Date' },
      cancelNotes: { type: 'String' },

      // billing & pricing
      invoiceAddress: { type: 'Pointer', targetClass: 'Address' },
      invoicingAt: { type: 'String', default: 'start' }, // start or end (default: start)
      billingCycle: { type: 'Number', required: true },
      paymentType: { type: 'Number' },
      dueDays: { type: 'Number' },
      pricingModel: { type: 'String' }, // gradual | none
      gradualPriceMap: { type: 'Pointer', targetClass: 'GradualPriceMap' },
      skipInvoiceEmails: { type: 'Boolean' },
      invoiceDescription: { type: 'String' },
      lateStart: { type: 'Object' },

      // agency
      agency: { type: 'Pointer', targetClass: 'Company' },
      agencyPerson: { type: 'Pointer', targetClass: 'Person' },
      commissions: { type: 'Object' },
      commission: { type: 'Number' },

      disassembly: { type: 'Boolean' }, // demontage von Rheinkultur

      docs: { type: 'Array' },
      tags: { type: 'Array' },
      responsibles: { type: 'Array' },

      // calculated
      cubeCount: { type: 'Number' },
      totalDuration: { type: 'Number' }
    }
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
      ort: { type: 'String' }, // city
      state: { type: 'Pointer', targetClass: 'State' }, // State

      order: { type: 'Object' }, // current active order
      vAt: { type: 'Date' }, // verifiedAt Date
      cAt: { type: 'Date' }, // lastControlledAt Date
      sAt: { type: 'Date' }, // lastScoutedAt Date
      dAt: { type: 'Date' }, // deletedAt Date

      // warnings
      MBfD: { type: 'Boolean' }, // Boolean // promoted location (göferderter Standort)
      PG: { type: 'Boolean' }, // Boolean // Privates Grundstück
      Agwb: { type: 'Boolean' }, // Boolean // Aus grau wird bunt
      TTMR: { type: 'Boolean' }, // Boolean // Town Talker / Moskito Rahmen
      nMR: { type: 'String' }, // No Marketing Rights Reason, if any, in text format

      // photos
      p1: { type: 'Pointer', targetClass: 'CubePhoto' }, // Nauaufnahme
      p2: { type: 'Pointer', targetClass: 'CubePhoto' }, // Umfeld

      // belegung possibility
      sides: { type: 'Object' }, // Which sides can be used

      hti: { type: 'String' }, // housing type string from import
      importData: { type: 'Object' } // Object
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
      size1000: { type: 'File' }
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
      invoice: { type: 'Pointer', targetClass: 'Invoice' },
      reason: { type: 'String' }, // reason that will be added to introduction text
      introduction: { type: 'String' }, // introduction that will appear on lex office

      periodStart: { type: 'String' },
      periodEnd: { type: 'String' },

      // LEX
      lexNo: { type: 'String' },
      lexId: { type: 'String' },
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
      bookings: { type: 'Array' }, // filled only when a collection of bookings are invoiced in distributor quarterly bookings
      introduction: { type: 'String' }, // introduction that will appear on lex office

      // LEX
      lexNo: { type: 'String' },
      lexId: { type: 'String' },
      lexUri: { type: 'String' },
      voucherStatus: { type: 'String' }, // lex office status

      // Payment
      paymentType: { type: 'Number' }, // PAYMENT_TYPES
      dueDays: { type: 'Number', required: true, default: 14 },
      // dueDate: { type: 'String', required: true },

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

      /*
        net: Number // net total
        tax: Number // tax total
        gross: Number // gross total
       */

      // cached values
      // netTotal, taxTotal, total, alternative: total: { net, tax, gross }
      // cubeCount

      lineItems: { type: 'Array', required: true }, // required for lex office

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
      printFiles: { type: 'Object' }, // druckdaten
      printNotes: { type: 'Object' } // hinweise
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
      ort: { type: 'String', required: true },
      state: { type: 'Pointer', targetClass: 'State', required: true },
      nMR: { type: 'Boolean' }
    }
  },
  Media: {
    CLP: { ...readAuthOnly, ...writeMasterOnly }
  },
  Notification: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      user: { type: 'Pointer', targetClass: '_User' },
      message: { type: 'String', required: true },
      uri: { type: 'String' },
      data: { type: 'Object' },
      readAt: { type: 'Date' }
    }
  },
  DepartureList: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      type: { type: 'String', required: true }, // scout, control or disassembly
      briefing: { type: 'Pointer', targetClass: 'Briefing' },
      disassembly: { type: 'Pointer', targetClass: 'Disassembly' },
      control: { type: 'Pointer', targetClass: 'Control' },
      name: { type: 'String' },
      scout: { type: 'Pointer', targetClass: '_User' },
      manager: { type: 'Pointer', targetClass: '_User' },
      dueDate: { type: 'String' },
      quota: { type: 'Number' }, // only for scout type
      ort: { type: 'String' },
      state: { type: 'Pointer', targetClass: 'State' },
      cubesQuery: { type: 'Object' }, // TODO: Remove duplicated computed?
      status: { type: 'String' }, // DEPARTURE_LIST_STATUSES
      cubeIds: { type: 'Array', default: [] },
      cubeCount: { type: 'Number', default: 0 },
      pendingCubeIds: { type: 'Array' }, // scout form submitted
      pendingCubeCount: { type: 'Number', default: 0 },
      approvedCubeIds: { type: 'Array' }, // approved after scouting
      adminApprovedCubeIds: { type: 'Array' }, // approved w/o scouting
      approvedCubeCount: { type: 'Number', default: 0 }
    }
  },
  ScoutSubmission: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      departureList: { type: 'Pointer', targetClass: 'DepartureList' },
      cube: { type: 'Pointer', targetClass: 'Cube', required: true },
      scout: { type: 'Pointer', targetClass: '_User', required: true },
      status: { type: 'String' },
      form: { type: 'Object' },
      photos: { type: 'Array' },
      scoutedAt: { type: 'Date' } // TODO: Maybe remove in favor of using createdAt
    }
  },
  ControlSubmission: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      departureList: { type: 'Pointer', targetClass: 'DepartureList' },
      cube: { type: 'Pointer', targetClass: 'Cube', required: true },
      scout: { type: 'Pointer', targetClass: '_User', required: true },
      condition: { type: 'String' },
      beforePhoto: { type: 'Pointer', targetClass: 'FileObject' },
      afterPhoto: { type: 'Pointer', targetClass: 'FileObject' },
      comment: { type: 'String' },
      rejectionReason: { type: 'String' }
    }
  },
  DisassemblySubmission: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      departureList: { type: 'Pointer', targetClass: 'DepartureList' },
      cube: { type: 'Pointer', targetClass: 'Cube', required: true },
      scout: { type: 'Pointer', targetClass: '_User', required: true },
      condition: { type: 'String' },
      photo: { type: 'Pointer', targetClass: 'FileObject' }
    }
  },
  // TODO: Remove in favor of using enums
  State: {
    CLP: { ...readAuthOnly, ...writeMasterOnly },
    fields: {
      name: { type: 'String', required: true }
    }
  },
  Tag: {
    CLP: { ...readAuthOnly, ...writeMasterOnly }
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
  const { CLP: classLevelPermissions, fields } = schemaDefinitions[className]
  definitions.push({
    className,
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
  strict: true
}
