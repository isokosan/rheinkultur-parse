const Order = {
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
    // status: { type: 'Number', required: true },
    company: { type: 'Pointer', targetClass: 'Company', required: true },
    companyPerson: { type: 'Pointer', targetClass: 'Person' },

    // duration settings
    startsAt: { type: 'String' },
    initialDuration: { type: 'Number' },
    endsAt: { type: 'String' },
    autoExtendsAt: { type: 'String' },
    autoExtendsBy: { type: 'Number', default: 12 },
    noticePeriod: { type: 'Number' },
    extendedDuration: { type: 'Number' },
    earlyCancellations: { type: 'Object' },

    // extra data
    data: { type: 'Object' },
    // motive: { type: 'String' },
    // orderNo: { type: 'String' },
    // campaignNo: { type: 'String' },

    // calculated
    cubeCount: { type: 'Number' },
    totalDuration: { type: 'Number' },

    docs: { type: 'Array' },
    tags: { type: 'Array' },
    responsibles: { type: 'Array' }
  }
}

const OrderCube = {
  CLP: {
    get: { '*': true },
    find: { requiresAuthentication: true },
    count: { requiresAuthentication: true },
    create: {},
    update: {},
    delete: {}
  },
  fields: {
    cube: { type: 'Pointer', targetClass: 'Cube', required: true },
    order: { type: 'Pointer', targetClass: 'Order' },
    // overwrite fields
    startsAt: { type: 'String' },
    endsAt: { type: 'String' },

    // price fields
    price: { type: 'Number', required: true }
    //   net: Number "RkNetto preis"
    //   end: Number "Endkunde preis"
    //   gl: Pointer to Gradual Price
    //   start: String, // When null then same as order start
    //   end: String, // When null then same as order end

  }
}

const schemaDefinitions = {
  Order,
  OrderCube
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
