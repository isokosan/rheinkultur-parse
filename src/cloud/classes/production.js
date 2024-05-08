const Production = Parse.Object.extend('Production')
const { camelCase, sum } = require('lodash')
const { round2 } = require('@/utils')
const { PRINT_PACKAGE_FILES } = require('@/schema/enums')

Parse.Cloud.beforeSave(Production, async ({ object: production }) => {
  if (production.get('booking') && production.get('contract')) {
    throw new Error('Production cannot be tied to a booking and a contract simultaneously')
  }
  const order = production.get('booking') || production.get('contract') || production.get('offer')
  await order.fetch({ useMasterKey: true })

  const cubeIds = order.get('cubeIds') || []
  // remove cubes that are not in booking/contract from dictionaries
  for (const key of [
    'printPackages',
    'prices',
    'extras',
    'totals',
    'monthlies',
    'printTemplates',
    'printFiles',
    'printNotes'
  ]) {
    production.set(key, $cleanDict(production.get(key), cubeIds))
  }
  !production.get('printPackages') && production.set('printPackages', {})

  const total = round2(sum(Object.values(production.get('totals') || {})))
  production.set({ total })

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
    throw new Error('Preis kann nicht null sein, bitte Preis eintragen oder Produktion nicht abrechnen auswählen.')
  }

  !production.get('assembly') && production
    .unset('assembly')
    .unset('dueDate')
    .unset('printFilesDue')
    .unset('assembler')
    .unset('assemblyStart')
    .unset('realizedDate')
    .unset('printTemplates')
    .unset('printFiles')
    .unset('printNotes')
  if (production.get('assembly')) {
    const defaultDates = {
      dueDate: order.get('startsAt'),
      // printFilesDue: moment(order.get('startsAt')).subtract(1, 'month').format('YYYY-MM-DD'),
      assemblyStart: moment(order.get('startsAt')).subtract(1, 'week').format('YYYY-MM-DD')
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
})

const getPrintFileIds = printFiles => [...new Set(Object.values(printFiles || {})
  .map(files => Object.values(files || {}).map(file => file.id))
  .flat()
)]

Parse.Cloud.beforeFind(Production, ({ query }) => {
  query.include(['booking', 'contract', 'offer'])
})

Parse.Cloud.afterFind(Production, async ({ query, objects }) => {
  for (const production of objects) {
    production.set('order', production.get('booking') || production.get('contract') || production.get('offer'))
  }
  if (query._include.includes('printFiles')) {
    const fileIds = [...new Set(objects.map(production => getPrintFileIds(production.get('printFiles'))).flat())]
    const fileObjects = await $query('FileObject')
      .containedIn('objectId', fileIds)
      .limit(fileIds.length)
      .find({ useMasterKey: true })
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

Parse.Cloud.define('production-add-assembly', async ({ params: { productionId } }) => {
  const production = await $getOrFail(Production, productionId)
  production.set({ assembly: true })
  return production.save(null, { useMasterKey: true })
}, $internOrAdmin)

Parse.Cloud.define('production-update-assembly', async ({
  params: {
    productionId,
    dueDate,
    printFilesDue,
    assembler,
    assemblyStart,
    printFileIds,
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

  const cubeIds = (production.get('booking') || production.get('contract') || production.get('offer')).get('cubeIds')

  const printFiles = {}
  for (const key of Object.keys(printFileIds)) {
    const fileObjectId = printFileIds[key]
    if (!fileObjectId) {
      continue
    }
    const [cubeId, face] = key.split('+')
    if (!cubeIds.includes(cubeId)) {
      continue
    }
    if (!(cubeId in printFiles)) {
      printFiles[cubeId] = {}
    }
    printFiles[cubeId][face] = $parsify('FileObject', fileObjectId)
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
}, $internOrAdmin)

// TODO: remove unused files every night?
Parse.Cloud.define('production-delete-unused-files', async ({ params: { productionId } }) => {
  const production = await $getOrFail(Production, productionId)
  const usedFileIds = getPrintFileIds(production.get('printFiles'))
  return $query('FileObject')
    .startsWith('assetType', `Production_${production.id}`)
    .notContainedIn('objectId', usedFileIds)
    .each(file => file.destroy({ useMasterKey: true }), { useMasterKey: true })
}, { requireMaster: true })
