const readPublic = {
  get: { '*': true },
  find: { '*': true },
  count: { '*': true }
}
const writeMasterOnly = {
  create: {},
  update: {},
  delete: {}
}

const schemaDefinitions = {
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

      // warnings
      MBfD: { type: 'Boolean' }, // Boolean // promoted location (göferderter Standort)
      PG: { type: 'Boolean' }, // Boolean // Privates Grundstück
      Agwb: { type: 'Boolean' }, // Boolean // Aus grau wird bunt
      TTMR: { type: 'Boolean' }, // Boolean // Town Talker / Moskito Rahmen
      nMR: { type: 'String' }, // No Marketing Rights Reason, if any, in text format

      hti: { type: 'String' }, // housing type string from import
      importData: { type: 'Object' } // Object
    }
  }
}

const definitions = []
for (const className of Object.keys(schemaDefinitions)) {
  const { CLP: classLevelPermissions, fields } = schemaDefinitions[className]
  definitions.push({
    className,
    classLevelPermissions,
    fields
  })
}

module.exports = {
  definitions,
  strict: true,
  deleteExtraFields: true,
  recreateModifiedFields: true
}
