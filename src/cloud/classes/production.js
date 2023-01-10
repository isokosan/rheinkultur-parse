const Production = Parse.Object.extend('Production')
const { camelCase, sum } = require('lodash')
const { round2 } = require('@/utils')
const { PRINT_PACKAGE_FILES } = require('@/schema/enums')

Parse.Cloud.beforeSave(Production, async ({ object: production }) => {
  if (production.get('booking') && production.get('contract')) {
    throw new Error('Production cannot be tied to a booking and a contract simultaneously')
  }
  // clear cubeIds if tied to booking or contract
  if (production.get('booking') || production.get('contract')) {
    production.unset('cubeIds')
  }

  !production.get('billing') && production.set({
    monthlies: null,
    interestRate: null,
    prices: null,
    extras: null,
    totals: null,
    total: null
  })

  !(production.get('billing') > 1) && production.set({ monthlies: null })

  if (production.get('billing') && !production.get('total')) {
    // TOTRANSLATE
    throw new Error('Preis kann nicht null sein, bitte Preis eintragen oder Produktion nicht abrechnen auswählen.')
  }

  const bookingOrContract = production.get('booking') || production.get('contract')
  await bookingOrContract.fetch({ useMasterKey: true })

  !production.get('assembly') && production
    .unset('assembly')
    .unset('dueDate')
    .unset('printFilesDue')
    .unset('assembler')
    .unset('assemblyStart')
    .unset('realizedDate')
    .unset('printNotes')
    .unset('printFiles')
  if (production.get('assembly')) {
    const defaultDates = {
      dueDate: bookingOrContract.get('startsAt'),
      printFilesDue: moment(bookingOrContract.get('startsAt')).subtract(1, 'months').format('YYYY-MM-DD'),
      assemblyStart: moment(bookingOrContract.get('startsAt')).subtract(1, 'weeks').format('YYYY-MM-DD')
    }
    for (const key of Object.keys(defaultDates)) {
      !production.get(key) && production.set(key, defaultDates[key])
    }
    const cubeIds = Object.keys(production.get('printPackages'))
    const cubes = await $query('Cube')
      .containedIn('objectId', cubeIds)
      .limit(cubeIds.length)
      .include(PRINT_PACKAGE_FILES.map(file => 'ht.' + file))
      .find({ useMasterKey: true })
    const printTemplates = {}
    for (const cube of cubes) {
      const printPackage = production.get('printPackages')[cube.id]
      if (!printPackage) {
        continue
      }
      const templates = {}
      for (const face of Object.keys(printPackage.faces || {})) {
        const fileKey = camelCase([printPackage.type, face, 'file'].join(' '))
        const count = printPackage.faces[face]
        const template = {
          face,
          type: printPackage.type,
          count,
          fileUrl: cube.get('ht').get(fileKey)?.get('file')?.url?.()
        }
        if (face === 'side') {
          templates.left = { ...template, count: 1, face: 'left' }
          templates.right = { ...template, count: 1, face: 'right' }
          continue
        }
        templates[face] = template
      }

      if (templates.top) {
        delete templates.top
        if (templates.front) {
          templates.front.description = 'Mit Deckel'
        }
      }
      printTemplates[cube.id] = templates
    }
    production.set('printTemplates', printTemplates)
    !production.get('printFiles') && production.set('printFiles', {})
    !production.get('printNotes') && production.set('printNotes', {})
  }

  !production.get('disassembly') && production
    .unset('disassemblyRMV')
    .unset('disassemblyStart')

  if (production.get('disassembly')) {
    // if the contract or booking is not auto-extending or its canceled and if the disassembly date is not given
    if (!bookingOrContract.get('willExtend') && !production.get('disassemblyStart')) {
      production.set('disassemblyStart', moment(bookingOrContract.get('endsAt')).add(1, 'days').format('YYYY-MM-DD'))
    }
    // if the contract or booking is going to extend but a disassembly date has been set, clear it
    if (bookingOrContract.get('willExtend') && production.get('disassemblyStart')) {
      production.unset('disassemblyStart')
    }
  }
})

const getPrintFileIds = printFiles => [...new Set(Object.values(printFiles || {})
  .map(files => Object.values(files || {}).map(file => file.id))
  .flat()
)]

// delete unused print files after save
Parse.Cloud.afterSave(Production, async ({ object: production }) => {
  const usedFileIds = getPrintFileIds(production.get('printFiles'))
  const unusedFiles = await $query('FileObject')
    .startsWith('assetType', `Production_${production.id}`)
    .notContainedIn('objectId', usedFileIds)
    .find({ useMasterKey: true })
  unusedFiles.map(file => file.destroy({ useMasterKey: true }))
})

Parse.Cloud.beforeFind(Production, ({ query }) => {
  query.include(['booking', 'contract'])
})

Parse.Cloud.afterFind(Production, async ({ query, objects }) => {
  for (const production of objects) {
    production.set('bookingOrContract', production.get('booking') || production.get('contract'))
  }
  if (query._include.includes('printFiles')) {
    const fileIds = [...new Set(objects.map(production => getPrintFileIds(production.get('printFiles'))).flat())]
    const fileObjects = await $query('FileObject').containedIn('objectId', fileIds).limit(1000).find({ useMasterKey: true })
    for (const production of objects) {
      const printFiles = production.get('printFiles')
      for (const cubeId of Object.keys(printFiles)) {
        for (const face of Object.keys(printFiles[cubeId])) {
          printFiles[cubeId][face] = fileObjects.find(({ id }) => id === printFiles[cubeId][face].id)
        }
      }
      production.set('printFiles', printFiles)
    }
  }
})

Parse.Cloud.define('production-update-cubes', async ({ params: { id: productionId, cubeIds } }) => {
  const production = await $getOrFail(Production, productionId)
  for (const key of ['printPackages', 'monthlies', 'prices', 'extras', 'totals']) {
    const obj = production.get(key) || {}
    for (const cubeId of Object.keys(obj)) {
      if (!cubeIds.includes(cubeId)) {
        delete obj[cubeId]
      }
    }
    production.set({ key: obj })
  }
  const total = round2(sum(Object.values(production.get('totals') || {})))
  production.set({ total })
  return production.save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('production-add-assembly', async ({ params: { productionId } }) => {
  const production = await $getOrFail(Production, productionId)
  production.set({ assembly: true })
  return production.save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('production-update-assembly', async ({
  params: {
    productionId,
    dueDate,
    printFilesDue,
    assembler,
    assemblyStart,
    printFiles: rawPrintFiles,
    printNotes: rawPrintNotes
  }
}) => {
  const production = await $getOrFail(Production, productionId)

  production.set({
    dueDate,
    printFilesDue,
    assembler,
    assemblyStart
  })

  const cubeIds = (production.get('booking') || production.get('contract')).get('cubeIds')

  const printFiles = {}
  for (const key of Object.keys(rawPrintFiles)) {
    const fileObject = rawPrintFiles[key]
    if (!fileObject) {
      continue
    }
    const [cubeId, face] = key.split('+')
    if (!cubeIds.includes(cubeId)) {
      continue
    }
    if (!(cubeId in printFiles)) {
      printFiles[cubeId] = {}
    }
    printFiles[cubeId][face] = $parsify('FileObject', fileObject.objectId)
  }

  const printNotes = {}
  for (const cubeId of Object.keys(rawPrintNotes)) {
    if (!cubeIds.includes(cubeId) || !rawPrintNotes[cubeId]) {
      continue
    }
    printNotes[cubeId] = rawPrintNotes[cubeId]
  }
  production.set({ printFiles, printNotes })

  return production.save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('production-add-disassembly', async ({ params: { productionId } }) => {
  const production = await $getOrFail(Production, productionId)
  production.set({ disassembly: true })
  return production.save(null, { useMasterKey: true })
}, { requireUser: true })

Parse.Cloud.define('production-update-disassembly', async ({
  params: {
    productionId,
    disassemblyRMV,
    disassemblyStart,
    disassemblyCompleted
  }
}) => {
  const production = await $getOrFail(Production, productionId)
  // const changes = $changes(production, { disassemblyRMV, disassemblyStart, disassemblyCompleted })
  production.set({ disassemblyRMV, disassemblyStart, disassemblyCompleted })
  return production.save(null, { useMasterKey: true })
}, { requireUser: true })
