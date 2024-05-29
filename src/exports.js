require('./globals')
const express = require('express')
const router = express.Router()

const Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)

const excel = require('exceljs')
const fetch = require('node-fetch')

const { lowerFirst } = require('lodash')

const elastic = require('@/services/elastic')
const { drive } = require('@/services/googleapis')
const { getLexFile, getLexInvoiceDocument, getLexCreditNoteDocument } = require('@/services/lex')
const { getOrderClassName, getCubeSummaries } = require('@/shared')
const { round2, round5, dateString, durationString } = require('@/utils')
const { fetchHousingTypes } = require('@/cloud/classes/housing-types')
const { fetchStates } = require('@/cloud/classes/states')
const { generateContractExtend } = require('@/docs')
const { CUBE_STATUSES, CUBE_FEATURES } = require('@/schema/enums')

// validate session and attach user from Parse,
const EXPORT_MASTER_ROUTES = [
  '/invoice-pdf',
  '/credit-note-pdf',
  '/invoice-summary',
  '/contract-extend-pdf',
  '/offer-pdf'
]
router.use(async (req, res, next) => {
  req.master = EXPORT_MASTER_ROUTES.includes(req._parsedUrl.pathname) && req.headers['x-exports-master-key'] === process.env.EXPORTS_MASTER_KEY
  req.sessionToken = req.query.sid
  const session = req.query.sid && await $query(Parse.Session)
    .equalTo('sessionToken', req.sessionToken)
    .include('user')
    .first({ useMasterKey: true })
  req.user = session?.get('user')
  if (!req.master && !req.user) {
    return res.status(401).send('Unbefügter Zugriff.')
  }
  next()
})

const handleErrorAsync = func => (req, res, next) => func(req, res, next).catch((error) => next(error))

const safeName = name => name
  .replace(/[/\\?%*:|"<>.]/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/,/g, '')
  .trim()

const getAttachmentContentDisposition = (fn, ext) => `attachment; filename*=UTF-8''${encodeURI(safeName(fn))}.${ext}`

// common sheets functions
function getColumnHeaders (headers) {
  const columns = []
  const headerRowValues = []
  for (const key of Object.keys(headers)) {
    const column = headers[key]
    headerRowValues.push(column.header)
    delete column.header
    columns.push({ key, ...column })
  }
  return { columns, headerRowValues }
}

const parseCubeFeatures = (features = {}) => Object.keys(features).reduce((acc, key) => {
  acc[key] = CUBE_FEATURES[key].values[features[key]] || ''
  return acc
}, {})

const alignCenter = { alignment: { horizontal: 'center' } }
const alignRight = { alignment: { horizontal: 'right' } }
const dateStyle = { numFmt: 'dd.mm.yyyy', ...alignRight }
const priceStyle = { numFmt: '#,##0.00 "€";[Red]-#,##0.00 "€"', ...alignRight }
const percentStyle = { numFmt: '#.##"%";#.##"%";""', ...alignRight }
const monthsStyle = { numFmt: '#.####', ...alignRight }
const numberStyle = { numFmt: '#,####', ...alignRight }

function paintCell (cell, color) {
  const argb = color.startsWith('#') ? color.substr(1) : color
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb },
    bgColor: { argb }
  }
  cell.border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' }
  }
}

function paintRow (row, color, colCount) {
  for (let r = 1; r <= colCount; r++) {
    paintCell(row.getCell(r), color)
  }
}

router.get('/cubes', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.stream.xlsx.WorkbookWriter({ useStyles: true })
  const worksheet = workbook.addWorksheet('CityCubes')

  const fields = {
    objectId: { header: 'CityCube ID', width: 30 },
    verified: { header: 'Verifiziert', width: 20 },

    companyName: { header: 'Kunde/VP', width: 40 },
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnenname', width: 20 },

    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 15 },
    hsnr: { header: 'Hausnummer', width: 15 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 15 },
    stateName: { header: 'Bundesland', width: 20 },

    start: { header: 'Startdatum', width: 12, style: dateStyle },
    end: { header: 'Enddatum', width: 12, style: dateStyle },
    duration: { header: 'Laufzeit', width: 10, style: alignRight },
    autoExtends: { header: 'Autoverl.', width: 10, style: alignCenter },

    lat: { header: 'Breite', width: 13 },
    lon: { header: 'Länge', width: 13 }
  }

  const companyIdNameMap = {}
  if (!req.query.s?.split(',').includes('6')) {
    delete fields.companyName
    delete fields.motive
    delete fields.externalOrderNo
    delete fields.campaignNo
    delete fields.start
    delete fields.end
    delete fields.duration
    delete fields.autoExtends
  } else {
    await $query('Company')
      .select('name')
      .eachBatch((companies) => {
        for (const company of companies) {
          companyIdNameMap[company.id] = company.get('name')
        }
      }, { useMasterKey: true })
  }

  // Add cube features
  for (const cubeFeature of Object.keys(CUBE_FEATURES)) {
    fields[cubeFeature] = { header: CUBE_FEATURES[cubeFeature].label, width: 30 }
  }

  const { columns, headerRowValues } = getColumnHeaders(fields)
  worksheet.columns = columns

  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true }
  headerRow.height = 24

  const { index, query, sort } = await Parse.Cloud.run('search', { ...req.query, returnQuery: true }, { useMasterKey: true })
  const keepAlive = '1m'
  const size = 5000
  // Sorting should be by _shard_doc or at least include _shard_doc
  sort.push({ _shard_doc: 'desc' })
  let searchAfter
  let pointInTimeId = (await elastic.openPointInTime({ index, keep_alive: keepAlive })).id
  while (true) {
    const { pit_id, hits: { hits } } = await elastic.search({
      body: {
        pit: {
          id: pointInTimeId,
          keep_alive: keepAlive
        },
        size,
        track_total_hits: false,
        query,
        sort,
        search_after: searchAfter
      }
    })
    if (!hits || !hits.length) {
      break
    }
    pointInTimeId = pit_id
    for (const row of hits.map(({ _source: doc }) => {
      doc.verified = doc.vAt ? 'Ja' : ''
      doc.htCode = (doc.ht ? housingTypes[doc.ht.objectId]?.code : doc.hti) || doc.media || ''
      doc.stateName = states[doc.stateId]?.name || ''
      doc.lat = doc.gp.latitude
      doc.lon = doc.gp.longitude
      if (doc.features) {
        for (const key of Object.keys(CUBE_FEATURES)) {
          doc[key] = CUBE_FEATURES[key].values[doc.features[key]] || ''
        }
      }

      // TODO: update duration when early canceled
      const order = doc.order || doc.futureOrder
      if (order) {
        doc.companyName = companyIdNameMap[order.company.objectId]
        doc.motive = order.motive
        doc.externalOrderNo = order.externalOrderNo
        doc.campaignNo = order.campaignNo
        doc.start = dateString(order.startsAt)
        doc.end = dateString(order.earlyCanceledAt || order.endsAt)
        doc.duration = order.initialDuration + (order.extendedDuration ? '+' + order.extendedDuration : '')
        doc.autoExtends = order.autoExtendsBy ? 'Ja' : 'Nein'
      }
      return doc
    })) {
      worksheet.addRow(row)
    }
    if (hits.length < size) {
      break
    }
    // search after has to provide value for each sort
    const lastHit = hits[hits.length - 1]
    searchAfter = lastHit.sort
  }
  await elastic.closePointInTime({ id: pointInTimeId })
  worksheet.commit()
  const buffer = await new Promise((resolve, reject) => {
    workbook.commit().then(() => {
      const stream = workbook.stream
      const result = stream.read()
      resolve(result)
    }).catch((e) => {
      reject(e)
    })
  })
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition('CityCubes', 'xlsx'))
  res.set('Content-Length', buffer.length)
  return res.send(buffer)
}))

router.get('/hts', handleErrorAsync(async (req, res) => {
  const housingTypes = Object.values(await fetchHousingTypes())
  const states = Object.values(await fetchStates())
  const workbook = new excel.Workbook()
  const fields = {
    htCode: { header: 'Gehäusetyp', width: 20 },
    count: { header: 'Gesamt', width: 10, style: numberStyle }
  }
  for (const { objectId, name } of states) {
    fields[`state:${objectId}`] = { header: name, width: 15, style: numberStyle }
  }
  const { columns, headerRowValues } = getColumnHeaders(fields)
  const worksheet = workbook.addWorksheet('Sheet 1')
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 9 }
  headerRow.height = 24

  for (const { code: htCode, objectId } of housingTypes) {
    const row = { htCode }
    // use mongodb aggregate to count verified cubes by state
    const pipeline = [
      { $match: { _p_ht: 'HousingType$' + objectId, vAt: { $exists: true, $ne: null } } },
      { $group: { _id: '$state', count: { $sum: 1 } } }
    ]
    const counts = await $query('Cube').aggregate(pipeline)
    row.count = counts.reduce((sum, { count }) => sum + count, 0)
    for (const { objectId, count } of counts) {
      row[`state:${objectId}`] = count
    }
    worksheet.addRow(row)
  }
  const filename = `Verifizierte Gehäusetypen nach Bundesland (Stand ${moment().format('DD.MM.YYYY')})`
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

const startOfUtcDate = val => val ? moment.utc(val).startOf('day').toDate() : undefined

function getCubeOrderDates (cube, { startsAt, endsAt, earlyCancellations, initialDuration, extendedDuration }) {
  const earlyCanceledAt = earlyCancellations?.[cube.id]
  const canceledEarly = Boolean(earlyCanceledAt)
  if (earlyCanceledAt === true) {
    return { duration: '0', canceledEarly }
  }
  return {
    start: startOfUtcDate(startsAt),
    end: startOfUtcDate(earlyCanceledAt || endsAt),
    duration: canceledEarly
      ? durationString(earlyCanceledAt, startsAt)
      : [initialDuration, extendedDuration].filter(Boolean).join('+'),
    canceledEarly
  }
}

function getCubeMonthlyMedia (cube, order) {
  const { pricingModel, monthlyMedia } = order.attributes
  if (pricingModel === 'gradual') {
    return 'Staffel'
  }
  if (pricingModel === 'zero') {
    return 0
  }
  return monthlyMedia?.[cube.id]
}

// http://localhost:1337/exports/order/Contract-AsaJNA61xX
router.get('/order/:orderKey', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.Workbook()
  const [className, objectId] = req.params.orderKey.split('-')
  const order = await $getOrFail(className, objectId)
  let cubeIds = req.query.cubeIds ? decodeURIComponent(req.query.cubeIds || '').split(',') : order.get('cubeIds')
  if (className === 'FrameMount' && !req.query.cubeIds) {
    cubeIds = cubeIds.filter(id => order.get('fmCounts')[id] > 0)
  }

  const fields = {
    orderNo: { header: 'Auftragsnr.', width: 15 },
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnenname', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    fmCount: { header: 'Anzahl Rahmen', width: 16, style: alignRight },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 20 },
    stateName: { header: 'Bundesland', width: 20 },
    start: { header: 'Startdatum', width: 12, style: dateStyle },
    end: { header: 'Enddatum', width: 12, style: dateStyle },
    duration: { header: 'Laufzeit', width: 10, style: alignRight },
    monthly: { header: 'Monatsmiete', width: 15, style: priceStyle },
    pp: { header: 'Belegungspaket', width: 20 }
  }
  if (className === 'FrameMount') {
    delete fields.orderNo
    delete fields.motive
    delete fields.externalOrderNo
    delete fields.campaignNo
    delete fields.start
    delete fields.end
    delete fields.duration
    delete fields.monthly
    delete fields.pp
  } else {
    delete fields.fmCount
    // delete fields.takedownCount
  }

  // Add cube features
  for (const cubeFeature of Object.keys(CUBE_FEATURES)) {
    fields[cubeFeature] = { header: CUBE_FEATURES[cubeFeature].label, width: 30 }
  }

  const { columns, headerRowValues } = getColumnHeaders(fields)

  const worksheet = workbook.addWorksheet(safeName(order.get('no') || order.get('pk')))
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24

  const { motive, externalOrderNo, campaignNo } = order.attributes
  const fieldName = lowerFirst(className)
  const production = await $query('Production').equalTo(fieldName, order).first({ useMasterKey: true })
  const printPackages = production?.get('printPackages') || {}
  const cubes = await $query('Cube').containedIn('objectId', cubeIds).limit(cubeIds.length).find({ useMasterKey: true })
  for (const cube of cubes) {
    const { start, end, duration, canceledEarly } = getCubeOrderDates(cube, order.attributes)
    const autoExtends = order.get('autoExtendsBy')
      ? ((order.get('canceledAt') || canceledEarly) ? 'nein (gekündigt)' : 'ja')
      : 'nein'

    const monthly = getCubeMonthlyMedia(cube, order)

    const row = worksheet.addRow({
      fmCount: order.get('fmCounts')?.[cube.id] || 0,
      orderNo: order.get('no'),
      motive,
      externalOrderNo,
      campaignNo,
      objectId: cube.id,
      htCode: housingTypes[cube.get('ht')?.id]?.code || cube.get('hti'),
      str: cube.get('str'),
      hsnr: cube.get('hsnr'),
      plz: cube.get('plz'),
      ort: cube.get('ort'),
      stateName: states[cube.get('state')?.id]?.name || '',
      start,
      end,
      duration,
      autoExtends,
      monthly,
      pp: [printPackages[cube.id]?.no, printPackages[cube.id]?.name].filter(Boolean).join(': '),
      canceledEarly,
      ...parseCubeFeatures(cube.get('features'))
    })
    canceledEarly && (row.getCell(12).font = { name: 'Calibri', color: { argb: 'ff2222' } })
    canceledEarly && (row.getCell(13).font = { name: 'Calibri', color: { argb: 'ff2222' } })
  }

  const filename = `${order.get('no') || order.get('pk')} (Stand ${moment().format('DD.MM.YYYY')})`
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

// http://localhost:1337/exports/company/FNFCxMgEEr
router.get('/company/:companyId', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.Workbook()

  const company = await $getOrFail('Company', req.params.companyId)

  const fields = {
    orderNo: { header: 'Auftragsnr.', width: 20 },
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnenname', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 20 },
    stateName: { header: 'Bundesland', width: 20 },
    start: { header: 'Startdatum', width: 12, style: dateStyle },
    end: { header: 'Enddatum', width: 12, style: dateStyle },
    duration: { header: 'Laufzeit', width: 10, style: alignRight },
    autoExtends: { header: 'Autoverl.', width: 15, style: alignRight },
    monthly: { header: 'Monatsmiete', width: 15, style: priceStyle },
    pp: { header: 'Belegungspaket', width: 20 }
  }

  // Add cube features
  for (const cubeFeature of Object.keys(CUBE_FEATURES)) {
    fields[cubeFeature] = { header: CUBE_FEATURES[cubeFeature].label, width: 30 }
  }

  const { columns, headerRowValues } = getColumnHeaders(fields)
  const worksheet = workbook.addWorksheet(safeName(company.get('name')))
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24

  const rows = []
  await $query('Contract')
    .equalTo('company', company)
    .equalTo('status', 3)
    .each(async (contract) => {
      const { motive, externalOrderNo, campaignNo, cubeIds } = contract.attributes
      const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
      const printPackages = production?.get('printPackages') || {}
      const cubes = await $query('Cube').containedIn('objectId', cubeIds).limit(cubeIds.length).find({ useMasterKey: true })
      for (const cube of cubes) {
        const { start, end, duration, canceledEarly } = getCubeOrderDates(cube, contract.attributes)
        const monthly = getCubeMonthlyMedia(cube, contract)
        const autoExtends = contract.get('autoExtendsBy')
          ? ((contract.get('canceledAt') || canceledEarly) ? 'nein (gekündigt)' : 'ja')
          : 'nein'

        rows.push({
          orderNo: contract.get('no'),
          motive,
          externalOrderNo,
          campaignNo,
          objectId: cube.id,
          htCode: housingTypes[cube.get('ht')?.id]?.code || cube.get('hti'),
          str: cube.get('str'),
          hsnr: cube.get('hsnr'),
          plz: cube.get('plz'),
          ort: cube.get('ort'),
          stateName: states[cube.get('state')?.id]?.name || '',
          start,
          end,
          duration,
          autoExtends,
          monthly,
          pp: [printPackages[cube.id]?.no, printPackages[cube.id]?.name].filter(Boolean).join(': '),
          canceledEarly,
          ...parseCubeFeatures(cube.get('features'))
        })
      }
    }, { useMasterKey: true })

  rows.sort((a, b) => {
    return a.orderNo === b.orderNo
      ? a.str.localeCompare(b.str, 'de') || a.hsnr.localeCompare(b.hsnr, 'de', { numeric: true })
      : b.orderNo.localeCompare(a.orderNo)
  })

  for (const item of rows) {
    const row = worksheet.addRow(item)
    item.canceledEarly && (row.getCell(13).font = { name: 'Calibri', bold: true, color: { argb: 'ff2222' } })
    item.canceledEarly && (row.getCell(14).font = { name: 'Calibri', bold: true, color: { argb: 'ff2222' } })
  }

  const filename = `Laufende Verträge ${company.get('name')} (Stand ${moment().format('DD.MM.YYYY')})`
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/kinetic-extensions/:quarter', handleErrorAsync(async (req, res) => {
  const quarter = req.params.quarter
  const { getQuarterStartEnd } = require('@/shared')
  const { start, end } = getQuarterStartEnd(quarter)
  const states = await fetchStates()

  const workbook = new excel.Workbook()
  const company = await $getOrFail('Company', 'FNFCxMgEEr')
  const { columns, headerRowValues } = getColumnHeaders({
    orderNo: { header: 'RMV intern\nAuftragsnr.', width: 15 },
    externalOrderNo: { header: 'Auftragsnummer.', width: 20 },
    campaignNo: { header: 'Kampagnenname Kinetic', width: 50, style: alignCenter },
    motive: { header: 'Kunde/Motiv - System RMV', width: 50, style: alignCenter },
    end: { header: 'Enddatum', width: 20, style: dateStyle },
    deadline: { header: 'Buchungsdeadline', width: 20, style: dateStyle },
    cubeCount: { header: 'Anzahl\nCubes', width: 13, style: alignCenter },
    total: { header: 'Summe', width: 20, style: priceStyle }
  })

  const worksheet = workbook.addWorksheet(safeName(company.get('name')))
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 40
  paintRow(headerRow, '##cecece', columns.length)

  const cityPopulations = await $query('City')
    .notEqualTo('population', null)
    .select('population')
    .limit(10000)
    .find({ useMasterKey: true })
    .then(cities => cities.reduce((map, city) => {
      map[city.id] = city.get('population')
      return map
    }, {}))

  function getPrice (pk) {
    const population = cityPopulations[pk]
    if (population && population >= 251000) {
      return 145
    }
    if (population && population >= 51000) {
      return 110
    }
    return 90
  }
  async function getTotal (contract) {
    const cubeIds = contract.get('cubeIds')
    const cubes = await $query('Cube')
      .containedIn('objectId', cubeIds)
      .limit(cubeIds.length)
      .select(['objectId', 'str', 'hsnr', 'ort', 'state'])
      .find({ useMasterKey: true })
    const pkCountsMap = cubes.reduce((map, cube) => {
      const pk = `${cube.get('state').id}:${cube.get('ort')}`
      map[pk] = (map[pk] || 0) + 1
      return map
    }, {})

    const rows = []
    for (const cube of cubes) {
      const pk = `${cube.get('state').id}:${cube.get('ort')}`
      rows.push({
        objectId: cube.id,
        ...cube.attributes,
        stateName: states[cube.get('state').id]?.name || '',
        population: cityPopulations[pk],
        total: getPrice(pk)
      })
    }

    const total = Object.keys(pkCountsMap).reduce((sum, pk) => {
      return round2(sum + getPrice(pk) * pkCountsMap[pk])
    }, 0)
    return { rows, total }
  }

  const { columns: contractColumns, headerRowValues: contractHeaderRowValues } = getColumnHeaders({
    objectId: { header: 'CityCube ID', width: 30 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hausnummer', width: 10 },
    ort: { header: 'Ort', width: 20, style: alignRight },
    stateName: { header: 'Bundesland', width: 20, style: alignRight },
    population: { header: 'Einwohner', width: 13, style: numberStyle },
    total: { header: 'Summe', width: 20, style: priceStyle }
  })

  const rows = []
  await $query('Contract')
    .equalTo('company', company)
    .equalTo('status', 3)
    .greaterThanOrEqualTo('endsAt', start)
    .lessThanOrEqualTo('endsAt', end)
    .eachBatch(async (contracts) => {
      for (const contract of contracts) {
        const contractsheet = workbook.addWorksheet(safeName(contract.get('no')))
        contractsheet.columns = contractColumns
        const headerRow = contractsheet.addRow(contractHeaderRowValues)
        headerRow.font = { name: 'Calibri', bold: true, size: 12 }
        headerRow.height = 40
        paintRow(headerRow, '##cecece', contractColumns.length)
        const { total, rows: cubeRows } = await getTotal(contract)
        contractsheet.addRows(cubeRows)
        const contractTotalRow = contractsheet.addRow({
          total: { formula: `SUM(G1:H${cubeRows.length})` }
        })
        contractTotalRow.height = 24
        contractTotalRow.font = { bold: true, size: 12 }

        rows.push({
          endsAt: contract.get('endsAt'), // for sorting
          orderNo: contract.get('no'),
          externalOrderNo: contract.get('externalOrderNo'),
          campaignNo: contract.get('campaignNo'),
          motive: contract.get('motive'),
          end: moment(contract.get('endsAt')).format('DD.MM.YYYY'),
          deadline: moment(contract.get('endsAt')).subtract(42, 'days').format('DD.MM.YYYY'),
          cubeCount: contract.get('cubeCount'),
          total
        })
      }
    }, { useMasterKey: true })

  rows.sort((a, b) => a.endsAt > b.endsAt ? 1 : -1)

  for (const item of rows) {
    const row = worksheet.addRow(item)
    paintCell(row.getCell(1), '#C5E0B3')
  }

  const totalRow = worksheet.addRow({
    cubeCount: { formula: `SUM(G1:G${rows.length})` },
    total: { formula: `SUM(H1:H${rows.length})` }
  })
  totalRow.height = 24
  totalRow.font = { bold: true, size: 12 }

  const filename = `Übersicht Aufträge Q${quarter} (Stand ${moment().format('DD.MM.YYYY')})`
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/assembly-list', handleErrorAsync(async (req, res) => {
  // const { PRINT_PACKAGE_TYPES } = require('@/schema/enums')
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const production = await $getOrFail('Production', req.query.id, ['booking', 'contract'])
  const order = await production.get('booking') || production.get('contract')
  const company = await order.get('company').fetch({ useMasterKey: true })

  if (company.id !== 'FNFCxMgEEr') {
    throw new Error('This function is only available for Kinetic orders.')
  }

  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('CityCubes')

  const period = [order.get('startsAt'), order.get('endsAt')]
    .map(d => moment(d).format('DD.MM.YYYY')).join(' - ')
  const assemblyStart = moment(production.get('assemblyStart')).format('DD.MM.YYYY')

  const firstRow = worksheet.getRow(1)
  firstRow.values = [order?.get('motive')]
  firstRow.height = 20
  firstRow.font = { bold: true, size: 10 }
  firstRow.alignment = { vertical: 'middle', horizontal: 'left' }
  worksheet.mergeCells('A1:D1')

  const infos = [
    { label: 'CityCube', content: 'Telekom Deutschland GmbH' },
    { label: 'Produkt / Medium', content: 'CityCube', bold: true },
    { label: 'Belegungsart', content: 'jeweils (Strassenzugewandte) Frontbelegung' },
    { label: 'Werbemittel', content: 'Trägerplatten (ALU-Dibond o.ä.)' },
    { label: 'Buchungszeitraum', content: `${period} (${order.get('initialDuration')} Monate)` },
    { label: 'Lieferung der Druckdaten', content: `bis spätestens ${moment(production.get('printFilesDue')).format('DD.MM.YYYY')}` },
    { label: 'Montagebeginn:', content: `ab ${assemblyStart}` }
  ]

  let i = 2
  for (const info of infos) {
    const row = worksheet.getRow(i)
    row.values = [info.label, info.content]
    row.height = 20
    info.bold && (row.getCell(2).font = { bold: true })
    row.alignment = { vertical: 'middle', horizontal: 'left' }
    worksheet.mergeCells(`B${i}:D${i}`)
    i++
  }

  const { columns, headerRowValues } = getColumnHeaders({
    stateName: { header: 'Bundesland', width: 20 },
    assemblyStart: { header: 'Erschließungstermin\n(bis spätestens)', width: 15, style: { ...dateStyle, ...alignCenter } },
    plz: { header: 'PLZ', width: 10, style: alignRight },
    ort: { header: 'Ort', width: 15 },
    qty: { header: 'Anzahl', width: 10, style: alignCenter },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    comments: { header: 'Bemerkungen', width: 40, style: alignCenter },
    ppMaterial: { header: 'Belegung Material', width: 15, style: alignCenter },
    ppNo: { header: 'Belegungsnummer', width: 15, style: alignCenter },
    x1: { header: 'Strassenzugewandte\nFront\n(Tür - oder Rückseite)', width: 15, style: alignCenter },
    x2: { header: 'Rest Streichen\n(wenn nötig)', width: 15, style: alignCenter },
    x3: { header: 'Volumenpreis (EK)', width: 20, style: priceStyle },
    assembler: { header: 'Wer montiert', width: 20, style: alignCenter }
  })

  worksheet.columns = columns

  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 8 }
  headerRow.height = 40
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  paintRow(headerRow, '#000090', columns.length)
  paintCell(headerRow.getCell(columns.length), '#C4909D')
  paintCell(headerRow.getCell(columns.length - 1), '#C4909D')
  i++
  const subHeaderRow = worksheet.addRow()
  paintRow(subHeaderRow, '#000090', columns.length)
  paintCell(subHeaderRow.getCell(columns.length), '#C4909D')
  paintCell(subHeaderRow.getCell(columns.length - 1), '#C4909D')
  i++

  const startOfDataRow = i

  const printPackages = production.get('printPackages')
  const cubeIds = Object.keys(printPackages)
  const cubes = await $query('Cube')
    .containedIn('objectId', cubeIds)
    .limit(cubeIds.length)
    .find({ useMasterKey: true })
  for (const cube of cubes) {
    const { str, hsnr, plz, ort, ht, state } = cube.attributes
    const pp = printPackages[cube.id]
    const row = worksheet.addRow({
      assemblyStart,
      objectId: cube.id,
      stateName: states[state.id]?.name || '',
      htCode: housingTypes[ht.id]?.code || '',
      str,
      hsnr,
      plz,
      ort,
      qty: 1,
      ppNo: pp?.no || '-',
      // ppMaterial: PRINT_PACKAGE_TYPES[pp?.type] || '-',
      ppMaterial: 'Trägerplatten',
      comments: production.get('printNotes')?.[cube.id],
      x1: 'X',
      x2: 'X',
      assembler: production.get('assembler') || '-'
    })
    const cell = row.getCell(columns.length)
    cell.font = { size: 8 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'fbff00' },
      bgColor: { argb: 'fbff00' }
    }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }
    i++
  }

  const totalRow = worksheet.addRow({
    qty: { formula: `SUM(E${startOfDataRow}:E${i - 1})` },
    x3: { formula: `SUM(O${startOfDataRow}:O${i - 1})` }
  })
  totalRow.height = 50
  totalRow.font = { bold: true, size: 12, color: '#FFFFFF' }
  totalRow.alignment = { vertical: 'middle', horizontal: 'center' }
  paintRow(totalRow, '#000090', columns.length)

  const contractOrBooking = production.get('contract') || production.get('booking')
  const filename = safeName(['Montageauftrag', contractOrBooking.get('motive'), contractOrBooking.get('no')].filter(Boolean).join(' '))
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () {
    res.status(200).end()
  })
}))

const addTaskListSheet = async (workbook, taskList) => {
  const parent = taskList.get('briefing') || taskList.get('control') || taskList.get('disassembly')?.get('order') || taskList.get('customService')
  const company = parent?.get('company') ? await parent.get('company').fetch({ useMasterKey: true }) : null
  const worksheet = workbook.addWorksheet(safeName(`${taskList.get('ort')} (${taskList.get('state').id}) ${moment(taskList.get('dueDate')).format('DD.MM.YYYY')}`))

  const infos = [
    { label: 'Auftraggeber', content: company?.get('name') || '-' },
    { label: 'Abfahrtsliste', content: `${taskList.get('ort')} (${taskList.get('state').get('name')})` },
    { label: 'Fälligkeitsdatum', content: taskList.get('dueDate') ? moment(taskList.get('dueDate')).format('DD.MM.YYYY') : '' }
  ]
  // singular quota
  if (taskList.get('quota')) {
    infos.push({ label: 'Anzahl', content: `${taskList.get('quota')}` })
  }
  // media based quota
  if (taskList.get('quotas')) {
    const quotas = taskList.get('quotas') || {}
    infos.push({
      label: 'Anzahl',
      content: Object.keys(quotas).map(media => `${media}: ${quotas[media]}`).join(', ')
    })
  }

  let i = 1
  for (const info of infos) {
    const row = worksheet.getRow(i)
    row.values = [info.label, info.content]
    row.height = 20
    row.getCell(1).font = { bold: true }
    row.alignment = { vertical: 'middle', horizontal: 'left' }
    worksheet.mergeCells(`B${i}:D${i}`)
    i++
  }
  worksheet.addRow()
  i++

  const taskListHeaders = {
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    // status: { header: 'Status', width: 15 },
    motive: { header: 'Motiv', width: 30 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 15 },
    ort: { header: 'Ort', width: 15 },
    stateName: { header: 'Bundesland', width: 30 },
    __empty1__: { header: 'Kommentar', width: 30 }
  }

  if (taskList.get('type') === 'scout') {
    delete taskListHeaders.motive
  }

  const { columns, headerRowValues } = getColumnHeaders(taskListHeaders)
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24

  const cubeIds = taskList.get('cubeIds') || []
  const cubes = await $query('Cube')
    .containedIn('objectId', cubeIds)
    .include(['ht', 'state'])
    .ascending('str')
    .addAscending('hsnr')
    .limit(cubeIds.length)
    .find({ useMasterKey: true })
  for (const cube of cubes) {
    const row = worksheet.addRow({
      objectId: cube.id,
      htCode: cube.get('ht')?.get('code') || cube.get('hti'),
      status: CUBE_STATUSES[cube.get('s') || 0],
      motive: cube.get('order')?.motive,
      str: cube.get('str'),
      hsnr: cube.get('hsnr'),
      plz: cube.get('plz'),
      ort: cube.get('ort'),
      stateName: cube.get('state').get('name')
    })
    for (let r = 1; r <= columns.length; r++) {
      const cell = row.getCell(r)
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'fbff00' },
        bgColor: { argb: 'fbff00' }
      }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    }
  }
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()

  // add extra cubes for briefings in area
  if (taskList.get('briefing')) {
    const { results } = await Parse.Cloud.run('search', {
      s: 'available',
      pagination: 1000,
      ort: taskList.get('ort'),
      state: taskList.get('state').id,
      sb: 'hsnr'
    }, { useMasterKey: true })
    for (const doc of results) {
      // TODO: Remove cubeIds that are in other briefing tasks in this area
      if (cubeIds.includes(doc.objectId)) {
        continue
      }
      const row = worksheet.addRow({
        objectId: doc.objectId,
        htCode: housingTypes[doc.ht?.id]?.code || doc.hti || '',
        status: CUBE_STATUSES[doc.s || 0],
        str: doc.str,
        hsnr: doc.hsnr,
        plz: doc.plz,
        ort: doc.ort,
        stateName: states[doc.stateId].name
      })
      for (let r = 1; r <= columns.length; r++) {
        const cell = row.getCell(r)
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      }
    }
  }
}
router.get('/task-list', handleErrorAsync(async (req, res) => {
  const taskList = await $query('TaskList')
    .include(['state', 'briefing', 'control', 'disassembly', 'customService'])
    .get(req.query.id, { useMasterKey: true })
  const parent = taskList.get('briefing') || taskList.get('control') || taskList.get('disassembly') || taskList.get('customService')
  await parent.get('order')?.fetch({ useMasterKey: true })
  let name = parent.get('name') || parent.get('order')?.get('no')
  if (taskList.get('type') === 'disassembly') {
    name = 'Demontage ' + name
  }
  const workbook = new excel.Workbook()
  await addTaskListSheet(workbook, taskList)
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(`${name} ${taskList.get('ort')}`, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))
router.get('/task-lists', handleErrorAsync(async (req, res) => {
  const [className] = req.query.parent.split('-')
  let name
  const parentQuery = $query(className)
  if (className === 'Disassembly') {
    const [, orderClass, orderId] = req.query.parent.split('-')
    const order = await $getOrFail(orderClass, orderId)
    name = 'Demontage ' + order.get('no')
    parentQuery.equalTo(lowerFirst(orderClass), order)
  } else {
    const objectId = req.query.parent.replace(`${className}-`, '')
    parentQuery.equalTo('objectId', objectId)
    name = await parentQuery.first({ useMasterKey: true }).then(parent => parent.get('name'))
  }
  const workbook = new excel.Workbook()
  await $query('TaskList')
    .matchesQuery(lowerFirst(className), parentQuery)
    .include('state')
    .each(async taskList => {
      await addTaskListSheet(workbook, taskList)
    }, { useMasterKey: true })
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(name, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))
router.get('/disassemblies', handleErrorAsync(async (req, res) => {
  const { start: from, end: to } = req.query
  const name = safeName(`Demontage ${[moment(from).format('DD.MM.YYYY'), moment(to).format('DD.MM.YYYY')].join('-')}`)
  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet(name)

  const { columns, headerRowValues } = getColumnHeaders({
    orderNo: { header: 'Auftragsnr.', width: 20 },
    orderType: { header: 'Auftragstyp.', width: 30 },
    customerName: { header: 'Kunde', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 15 },
    ort: { header: 'Ort', width: 15 },
    stateName: { header: 'Bundesland', width: 30 },
    motive: { header: 'Motiv', width: 20 },
    from: { header: 'Demontage ab', width: 15, style: dateStyle },
    status: { header: 'Status', width: 15 }
  })

  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24

  await $query('TaskList')
    .equalTo('type', 'disassembly')
    .greaterThanOrEqualTo('date', from)
    .lessThanOrEqualTo('date', to)
    .each(async taskList => {
      const cubeIds = taskList.get('cubeIds') || []
      const order = taskList.get('disassembly').get('order')
      await order.fetchWithInclude('company', { useMasterKey: true })
      const cubes = await $query('Cube')
        .containedIn('objectId', cubeIds)
        .include(['ht', 'state'])
        .limit(cubeIds.length)
        .find({ useMasterKey: true })
      for (const cube of cubes) {
        worksheet.addRow({
          orderNo: order.get('no'),
          orderType: getOrderClassName(order.className),
          customerName: order.get('company')?.get('name'),
          objectId: cube.id,
          htCode: cube.get('ht')?.get('code') || cube.get('hti'),
          str: cube.get('str'),
          hsNr: cube.get('hsnr'),
          plz: cube.get('plz'),
          ort: cube.get('ort'),
          stateName: cube.get('state').get('name'),
          motive: order.get('motive'),
          from: dateString(taskList.get('date'))
        })
      }
    }, { useMasterKey: true })

  // add all to rows
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(name, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))
router.get('/control-report/:reportId', handleErrorAsync(async (req, res) => {
  const report = await $getOrFail('ControlReport', req.params.reportId, ['control', 'company', 'company.tags'])
  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('Report')

  const infos = [
    { label: 'Kontrolle', content: report.get('control').get('name') || '-' },
    { label: 'Kunde/VP', content: report.get('company').get('name') || '-' },
    { label: 'Reperaturen erforderlich', content: report.get('counts').include }
  ]

  let i = 1
  for (const info of infos) {
    const row = worksheet.getRow(i)
    row.values = [info.label, info.content]
    row.height = 20
    row.getCell(1).font = { bold: true }
    row.alignment = { vertical: 'middle', horizontal: 'left' }
    worksheet.mergeCells(`B${i}:D${i}`)
    i++
  }
  worksheet.addRow()

  // prepare maps
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const isAldiReport = (report.get('company').get('tags') || []).find(tag => tag.get('name') === 'ALDI')

  const { columns, headerRowValues } = getColumnHeaders({
    objectId: { header: 'CityCube ID', width: 20 },
    orderNo: { header: 'Auftragsnr.', width: 15 },
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: isAldiReport ? 'VST' : 'Extern Auftragsnr.', width: 20 },
    campaignNo: { header: isAldiReport ? 'Regionalgesellschaft' : 'Kampagnenname', width: 20 },
    media: { header: 'Size', width: 10 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 20 },
    stateName: { header: 'Bundesland', width: 20 },
    end: { header: 'Enddatum', width: 12, style: dateStyle },
    condition: { header: 'Zustand', width: 20 },
    missingDisassembled: { header: 'Demontiert (fehlte)', width: 20 },
    pruned: { header: 'Grünschnitt', width: 20 },
    painted: { header: 'Streichen', width: 20 },
    comments: { header: 'Kommentar', width: 20 },
    cost: { header: 'Reparaturkosten', width: 20, style: priceStyle }
  })
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24

  const REPORT_CONDITIONS = {
    no_ad: 'Fehlt/Beschädigt',
    missing: 'Fehlt',
    damaged: 'Beschädigt',
    ill: 'Verschmutzt'
  }
  const submissionIds = Object.keys(report.get('submissions'))
    .filter(id => report.get('submissions')[id].status === 'include')
  const submissions = await $query('ControlSubmission')
    .containedIn('objectId', submissionIds)
    .include(['orders'])
    .limit(submissionIds.length)
    .include('cube')
    .find({ useMasterKey: true })
  for (const submission of submissions) {
    const cube = submission.get('cube')
    const { no: orderNo, motive, externalOrderNo, campaignNo } = submission.get('order')
    console.log(submission.get('order'))
    worksheet.addRow({
      objectId: cube.id,
      orderNo,
      motive,
      externalOrderNo,
      campaignNo,
      media: cube.get('media'),
      htCode: housingTypes[cube.get('ht')?.id]?.code || cube.get('hti'),
      str: cube.get('str'),
      hsnr: cube.get('hsnr'),
      plz: cube.get('plz'),
      ort: cube.get('ort'),
      stateName: states[cube.get('state')?.id]?.name || '',
      ...getCubeOrderDates(cube, submission.get('order')),
      condition: REPORT_CONDITIONS[submission.get('condition')] || '',
      missingDisassembled: submission.get('form')?.missingDisassembled ? 'Demontiert' : '',
      pruned: submission.get('form')?.pruned === 'yes' ? 'Erledigt' : '',
      painted: submission.get('form')?.painted === 'yes' ? 'Erledigt' : '',
      comments: report.get('submissions')[submission.id].comments || submission.comments || '',
      cost: report.get('submissions')[submission.id].cost
    })
  }

  const totalRow = worksheet.addRow({
    cost: { formula: `SUM(INDIRECT(ADDRESS(${i + 2},COLUMN(),4)):INDIRECT(ADDRESS(${i + submissions.length + 1},COLUMN(),4)))` }
  })
  totalRow.height = 24
  totalRow.font = { bold: true, size: 12 }

  res.set('Content-Disposition', getAttachmentContentDisposition('Schadenlist ' + report.get('control').get('name'), 'xlsx'))
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/invoice-summary', handleErrorAsync(async (req, res) => {
  const invoice = await $getOrFail('Invoice', req.query.id, ['contract', 'booking'])
  const periodStart = invoice.get('periodStart')
  const periodEnd = invoice.get('periodEnd')
  const mediaItems = invoice.get('media')?.items || []
  const productionItems = invoice.get('production')?.items || []
  const mediaItemIds = mediaItems.map(item => item.cubeId)
  const productionItemIds = productionItems.map(item => item.cubeId)
  const cubeIds = [...new Set([...mediaItemIds, ...productionItemIds])]
  const cubeSummaries = await getCubeSummaries(cubeIds)
  const orderNo = (invoice.get('contract') || invoice.get('booking'))?.get('no')
  const rows = []
  for (const mediaItem of mediaItems) {
    const cube = cubeSummaries[mediaItem.cubeId]
    const { str, hsnr, plz, ort } = cube
    const row = {
      objectId: cube.objectId,
      ht: cube.ht ? cube.ht.code : (cube.media || '-'),
      str,
      hsnr,
      plz,
      ort,
      orderId: mediaItem.orderId,
      orderNo,
      state: cube.stateName,
      periodStart: mediaItem.periodStart || periodStart,
      periodEnd: mediaItem.periodEnd || periodEnd,
      monthlyMedia: mediaItem.monthly,
      months: mediaItem.months,
      periodMedia: mediaItem.total
    }
    const production = productionItems.find(({ cubeId, orderId }) => cubeId === mediaItem.cubeId && orderId === mediaItem.orderId)
    if (production) {
      row.monthlyProduction = production.monthly
      row.periodInstallments = invoice.get('production')?.periodInstallments
      row.periodProduction = production.total
    }
    row.itemTotal = round2((row.periodProduction || 0) + (row.periodMedia || 0))
    rows.push(row)
  }
  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('CityCubes', {
    views: [{ state: 'frozen', ySplit: 1 }]
  })
  const columns = [
    {
      header: 'CityCube ID',
      key: 'objectId',
      width: 15
    },
    {
      header: 'Auftragsnr.',
      key: 'orderNo',
      width: 15
    },
    {
      header: 'Gehäusetyp',
      key: 'ht',
      width: 15
    },
    {
      header: 'Straße',
      key: 'str',
      width: 20
    },
    {
      header: 'Hausnummer',
      key: 'hsnr',
      style: alignRight,
      width: 10
    },
    {
      header: 'PLZ',
      key: 'plz',
      width: 15
    },
    {
      header: 'Stadt',
      key: 'ort',
      width: 15
    },
    {
      header: 'Bundesland',
      key: 'state',
      style: {
        alignment: { shrinkToFit: true }
      },
      width: 20
    }
  ]
  if (invoice.get('media')) {
    columns.push(...[
      {
        header: 'ZeitraumStart',
        key: 'periodStart',
        style: dateStyle,
        width: 15
      },
      {
        header: 'ZeitraumEnde',
        key: 'periodEnd',
        style: dateStyle,
        width: 15
      },
      {
        header: 'Monatsmiete',
        key: 'monthlyMedia',
        style: priceStyle,
        width: 20
      },
      {
        header: 'Anzahl Monate',
        key: 'months',
        style: monthsStyle,
        width: 15
      },
      {
        header: 'Zwischensumme',
        key: 'periodMedia',
        style: priceStyle,
        width: 15
      }
    ])
  }
  if (invoice.get('production')) {
    invoice.get('production')?.installments
      ? columns.push(...[
        {
          header: 'Production Monthly',
          key: 'monthlyProduction',
          style: priceStyle,
          width: 20
        },
        {
          header: 'Anzahl Monate',
          key: 'periodInstallments',
          style: {
            alignment: { horizontal: 'right' }
          },
          width: 20
        },
        {
          header: 'Zwischensumme Produktion',
          key: 'periodProduction',
          style: priceStyle,
          width: 20
        }
      ])
      : columns.push({
        header: 'Produktion',
        key: 'periodProduction',
        style: priceStyle,
        width: 20
      })
  }
  columns.push({
    header: 'Standort Summe',
    key: 'itemTotal',
    style: priceStyle,
    width: 20
  })
  worksheet.columns = columns
  worksheet.addRows(rows.map(row => ({
    ...row,
    periodStart: startOfUtcDate(row.periodStart),
    periodEnd: startOfUtcDate(row.periodEnd)
  })))
  const totalRow = worksheet.addRow({
    monthlyMedia: invoice.get('media')?.monthlyTotal,
    periodMedia: invoice.get('media')?.total,
    monthlyProduction: invoice.get('production')?.monthlyTotal,
    periodInstallments: invoice.get('production')?.periodInstallments,
    periodProduction: invoice.get('production')?.total,
    itemTotal: round2((invoice.get('production')?.total || 0) + (invoice.get('media')?.total || 0))
  })
  totalRow.font = { name: 'Calibri', bold: true }
  const headerRow = worksheet.getRow(1)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(`${invoice.get('lexNo') || ''} Rechnungsdetails`, 'xlsx'))
  return workbook.xlsx.write(res).then(function () {
    res.status(200).end()
  })
}))

router.get('/quarterly-reports/:quarter', handleErrorAsync(async (req, res) => {
  const { quarter } = req.params
  const { distributorId, agencyId, regionId, tagId, lessorCode } = req.query
  const report = await $query('QuarterlyReport')
    .equalTo('quarter', quarter)
    .descending('createdAt')
    .include('rows')
    .first({ useMasterKey: true })

  let filename = `Auftragsliste Q${quarter}`
  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('Quartalsbericht')
  const fields = {
    orderNo: { header: 'Auftragsnr.', width: 15 },
    companyName: { header: 'Kunde', width: 40 },
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnenname', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 20 },
    stateName: { header: 'Bundesland', width: 20 },
    start: { header: 'Startdatum', width: 12, style: dateStyle },
    end: { header: 'Enddatum', width: 12, style: dateStyle },
    duration: { header: 'Laufzeit', width: 10, style: alignRight },
    periodStart: { header: 'Zeitraumstart', width: 12, style: dateStyle },
    periodEnd: { header: 'Zeitraumende', width: 12, style: dateStyle },
    monthly: { header: 'Monatsmiete', width: 15, style: priceStyle },
    months: { header: 'Monate', width: 10, style: monthsStyle },
    total: { header: 'Zeitraumsumme', width: 15, style: priceStyle },
    agencyRate: { header: 'Agentur %', width: 10, style: percentStyle },
    agencyTotal: { header: 'Agentursumme', width: 15, style: priceStyle },
    regionalRate: { header: 'Region %', width: 10, style: percentStyle },
    regionalTotal: { header: 'Regionsumme', width: 15, style: priceStyle },
    serviceRate: { header: 'Service %', width: 10, style: percentStyle },
    serviceTotal: { header: 'Servicepauschale', width: 15, style: priceStyle },
    totalNet: { header: 'Rheinkultur Netto', width: 15, style: priceStyle },
    lessorRate: { header: 'Pacht %', width: 10, style: percentStyle },
    lessorTotal: { header: 'Pachtsumme', width: 15, style: priceStyle },
    voucherNos: { header: 'Belege.', width: 20 }
  }

  function findFieldKey (header) {
    for (const [key, dict] of Object.entries(fields)) {
      if (header === dict.header) {
        return key
      }
    }
    return null
  }

  if (distributorId) {
    const distributorName = await $getOrFail('Company', distributorId).then((company) => company.get('name'))
    filename = `${distributorName} Q${quarter}`
    delete fields.companyName
    delete fields.agencyRate
    delete fields.agencyTotal
    delete fields.regionalRate
    delete fields.regionalTotal
    delete fields.serviceRate
    delete fields.serviceTotal
    delete fields.totalNet
    delete fields.lessorRate
    delete fields.lessorTotal
    delete fields.voucherNos
  }
  if (agencyId) {
    const agencyName = await $getOrFail('Company', agencyId).then((company) => company.get('name'))
    filename = `${agencyName} Q${quarter}`
    delete fields.regionalRate
    delete fields.regionalTotal
    delete fields.serviceRate
    delete fields.serviceTotal
    delete fields.totalNet
    delete fields.lessorRate
    delete fields.lessorTotal
    delete fields.voucherNos
  }
  if (regionId) {
    const regionName = report.get('regionals')[regionId].name
    filename = `${regionName} Q${quarter}`
    delete fields.agencyRate
    delete fields.agencyTotal
    delete fields.serviceRate
    delete fields.serviceTotal
    delete fields.totalNet
    delete fields.lessorRate
    delete fields.lessorTotal
    delete fields.voucherNos
  }

  let orderNosFilter
  if (tagId) {
    const tag = await $getOrFail('Tag', tagId)
    orderNosFilter = await $query('Contract').equalTo('tags', tag).distinct('no', { useMasterKey: true })
    filename = `${tag.get('name')} Q${quarter}`
    delete fields.agencyRate
    delete fields.agencyTotal
    delete fields.regionalRate
    delete fields.regionalTotal
    delete fields.serviceRate
    delete fields.serviceTotal
    delete fields.totalNet
    delete fields.lessorRate
    delete fields.lessorTotal
    delete fields.voucherNos
  }

  if (lessorCode) {
    filename = `${lessorCode} Q${quarter} Pacht`
    delete fields.orderNo
    delete fields.objectId
    delete fields.externalOrderNo
    delete fields.campaignNo
    delete fields.periodStart
    delete fields.periodEnd
    delete fields.monthly
    delete fields.months
    delete fields.total
    delete fields.agencyRate
    delete fields.agencyTotal
    delete fields.regionalRate
    delete fields.regionalTotal
    delete fields.serviceRate
    delete fields.serviceTotal
    fields.totalNet.header = 'Kunden Netto'
    delete fields.voucherNos
  }

  const rows = report.get('rows').filter((row) => {
    if (distributorId) {
      return row.distributorId === distributorId
    }
    if (agencyId) {
      return row.agencyId === agencyId
    }
    if (orderNosFilter) {
      return orderNosFilter.includes(row.orderNo)
    }
    if (regionId) {
      return row.regionId === regionId
    }
    if (lessorCode) {
      return row.lc === lessorCode
    }
    return true
  }).map((row) => {
    row.start = dateString(row.start)
    row.end = dateString(row.end)
    row.periodStart = dateString(row.periodStart)
    row.periodEnd = dateString(row.periodEnd)
    for (const [header, value] of Object.entries(row.extraCols || {})) {
      const fieldKey = findFieldKey(header)
      if (fieldKey) {
        row[fieldKey] = value
      }
    }
    return row
  })

  // remove externalOrderNo / campaignNo columns if empty
  !rows.find(row => row.externalOrderNo) && (delete fields.externalOrderNo)
  !rows.find(row => row.campaignNo) && (delete fields.campaignNo)

  const { columns, headerRowValues } = getColumnHeaders(fields)
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 10 }
  worksheet.addRows(rows)

  // add total row
  const keys = ['monthly', 'total', 'agencyTotal', 'regionalTotal', 'serviceTotal', 'totalNet', 'lessorTotal']
  const totals = {}
  for (const key of keys.filter(key => key in fields)) {
    totals[key] = rows.reduce((sum, row) => round2(sum + (row[key] || 0)), 0)
  }
  const totalRow = worksheet.addRow(totals)
  totalRow.font = { name: 'Calibri', bold: true }

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/agency-monthly/:agencyId/:yearMonth', handleErrorAsync(async (req, res) => {
  const { agencyId, yearMonth } = req.params
  const agency = await $getOrFail('Company', agencyId)
  const filename = `Umsatzbericht ${agency.get('name')}} ${yearMonth}`
  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('Sheet 1')
  const fields = {
    orderNo: { header: 'Auftragsnr.', width: 15 },
    companyName: { header: 'Kunde', width: 40 },
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnenname', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 20 },
    stateName: { header: 'Bundesland', width: 20 },
    start: { header: 'Startdatum', width: 12, style: dateStyle },
    end: { header: 'Enddatum', width: 12, style: dateStyle },
    duration: { header: 'Laufzeit', width: 10, style: alignRight },
    periodStart: { header: 'Zeitraumstart', width: 12, style: dateStyle },
    periodEnd: { header: 'Zeitraumende', width: 12, style: dateStyle },
    monthly: { header: 'Monatsmiete', width: 15, style: priceStyle },
    months: { header: 'Monate', width: 10, style: monthsStyle },
    total: { header: 'Zeitraumsumme', width: 15, style: priceStyle },
    agencyRate: { header: 'Agentur %', width: 10, style: percentStyle },
    agencyTotal: { header: 'Agentursumme', width: 15, style: priceStyle },
    regionalRate: { header: 'Region %', width: 10, style: percentStyle },
    regionalTotal: { header: 'Regionsumme', width: 15, style: priceStyle },
    serviceRate: { header: 'Service %', width: 10, style: percentStyle },
    serviceTotal: { header: 'Servicepauschale', width: 15, style: priceStyle },
    totalNet: { header: 'Rheinkultur Netto', width: 15, style: priceStyle },
    lessorRate: { header: 'Pacht %', width: 10, style: percentStyle },
    lessorTotal: { header: 'Pachtsumme', width: 15, style: priceStyle },
    voucherNos: { header: 'Belege.', width: 20 }
  }

  function findFieldKey (header) {
    for (const [key, dict] of Object.entries(fields)) {
      if (header === dict.header) {
        return key
      }
    }
    return null
  }

  const rows = await Parse.Cloud.run('agency-monthly', { agencyId, yearMonth }, { useMasterKey: true })
    .then((rows) => rows.map((row) => {
      row.start = dateString(row.start)
      row.end = dateString(row.end)
      row.periodStart = dateString(row.periodStart)
      row.periodEnd = dateString(row.periodEnd)
      for (const [header, value] of Object.entries(row.extraCols || {})) {
        const fieldKey = findFieldKey(header)
        if (fieldKey) {
          row[fieldKey] = value
        }
      }
      return row
    }))

  // remove externalOrderNo / campaignNo columns if empty
  !rows.find(row => row.externalOrderNo) && (delete fields.externalOrderNo)
  !rows.find(row => row.campaignNo) && (delete fields.campaignNo)

  const { columns, headerRowValues } = getColumnHeaders(fields)
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 10 }
  worksheet.addRows(rows)

  // add total row
  const keys = ['monthly', 'total', 'agencyTotal', 'regionalTotal', 'serviceTotal', 'totalNet', 'lessorTotal']
  const totals = {}
  for (const key of keys.filter(key => key in fields)) {
    totals[key] = rows.reduce((sum, row) => round2(sum + (row[key] || 0)), 0)
  }
  const totalRow = worksheet.addRow(totals)
  totalRow.font = { name: 'Calibri', bold: true }

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/partner-quarter/:quarterId', handleErrorAsync(async (req, res) => {
  const partnerQuarter = await $getOrFail('PartnerQuarter', req.params.quarterId, 'rows')
  if (partnerQuarter.get('company').id !== req.user.get('company').id) {
    throw new Error('Unbefügter Zugriff')
  }

  const filename = `Aufträge Q${partnerQuarter.get('quarter')}`
  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('Quartalsbericht')
  const fields = {
    orderNo: { header: 'Auftragsnr.', width: 15 },
    motive: { header: 'Motiv', width: 30 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnenname', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 20 },
    stateName: { header: 'Bundesland', width: 20 },
    start: { header: 'Startdatum', width: 12, style: dateStyle },
    end: { header: 'Enddatum', width: 12, style: dateStyle },
    duration: { header: 'Laufzeit', width: 10, style: alignRight },
    autoExtends: { header: 'Autoverl.', width: 10, style: alignCenter },
    periodStart: { header: 'Zeitraumstart', width: 12, style: dateStyle },
    periodEnd: { header: 'Zeitraumende', width: 12, style: dateStyle },
    monthly: { header: 'Monatsmiete', width: 15, style: priceStyle },
    months: { header: 'Monate', width: 10, style: monthsStyle },
    total: { header: 'Zeitraumsumme', width: 15, style: priceStyle }
  }

  function findFieldKey (header) {
    for (const [key, dict] of Object.entries(fields)) {
      if (header === dict.header) {
        return key
      }
    }
    return null
  }

  const extraFields = await $query('Booking')
    .containedIn('no', partnerQuarter.get('rows').map(row => row.orderNo))
    .select(['no', 'externalOrderNo', 'campaignNo'])
    .limit(partnerQuarter.get('rows').length)
    .find({ useMasterKey: true })
    .then(orders => orders.reduce((dict, order) => {
      dict[order.get('no')] = {
        externalOrderNo: order.get('externalOrderNo'),
        campaignNo: order.get('campaignNo')
      }
      return dict
    }, {}))

  const rows = partnerQuarter.get('rows').map((row) => {
    row.start = dateString(row.start)
    row.end = dateString(row.end)
    row.periodStart = dateString(row.periodStart)
    row.periodEnd = dateString(row.periodEnd)
    row.autoExtends = row.autoExtendsBy
      ? row.canceledAt ? 'nein (gekündigt)' : 'ja'
      : 'nein'
    for (const [header, value] of Object.entries(row.extraCols || {})) {
      const fieldKey = findFieldKey(header)
      if (fieldKey) {
        row[fieldKey] = value
      }
    }
    row.externalOrderNo = extraFields[row.orderNo]?.externalOrderNo
    row.campaignNo = extraFields[row.orderNo]?.campaignNo
    return row
  })

  // remove externalOrderNo / campaignNo columns if empty
  !rows.find(row => row.externalOrderNo) && (delete fields.externalOrderNo)
  !rows.find(row => row.campaignNo) && (delete fields.campaignNo)

  const { columns, headerRowValues } = getColumnHeaders(fields)
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 10 }
  worksheet.addRows(rows)

  // add total row
  const keys = ['monthly', 'total']
  const totals = {}
  for (const key of keys.filter(key => key in fields)) {
    totals[key] = rows.reduce((sum, row) => round2(sum + (row[key] || 0)), 0)
  }
  const totalRow = worksheet.addRow(totals)
  totalRow.font = { name: 'Calibri', bold: true }

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/bookings', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.stream.xlsx.WorkbookWriter({ useStyles: true })
  const worksheet = workbook.addWorksheet('Meine Buchungen')

  const fields = {
    orderNo: { header: 'Auftragsnr.', width: 15 },
    companyName: { header: 'Kunde', width: 40 },
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnenname', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 20 },
    stateName: { header: 'Bundesland', width: 20 },
    start: { header: 'Startdatum', width: 12, style: dateStyle },
    end: { header: 'Enddatum', width: 12, style: dateStyle },
    duration: { header: 'Laufzeit', width: 10, style: alignRight },
    autoExtends: { header: 'Autoverl.', width: 10, style: alignCenter },
    periodStart: { header: 'Zeitraumstart', width: 12, style: dateStyle },
    periodEnd: { header: 'Zeitraumende', width: 12, style: dateStyle },
    monthly: { header: 'Monatsmiete', width: 15, style: priceStyle },
    months: { header: 'Monate', width: 10, style: monthsStyle },
    total: { header: 'Zeitraumsumme', width: 15, style: priceStyle }
  }

  if (req.user.accType === 'partner') {
    delete fields.companyName
  }
  if (!req.query.f && !req.query.t) {
    delete fields.periodStart
    delete fields.periodEnd
    delete fields.months
    delete fields.total
  }

  const { columns, headerRowValues } = getColumnHeaders(fields)
  worksheet.columns = columns

  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true }
  headerRow.height = 24

  const { index, query, sort } = await Parse.Cloud.run(
    'search-bookings',
    { ...req.query, sb: 'no', sd: 'asc', returnQuery: true },
    { sessionToken: req.sessionToken }
  )
  const keepAlive = '1m'
  const size = 5000
  // Sorting should be by _shard_doc or at least include _shard_doc
  sort.push({ _shard_doc: 'desc' })
  let searchAfter
  let pointInTimeId = (await elastic.openPointInTime({ index, keep_alive: keepAlive })).id
  let count = 0
  while (true) {
    const { pit_id, hits: { hits } } = await elastic.search({
      body: {
        pit: {
          id: pointInTimeId,
          keep_alive: keepAlive
        },
        size,
        track_total_hits: false,
        query,
        sort,
        search_after: searchAfter
      }
    })
    if (!hits || !hits.length) {
      break
    }
    pointInTimeId = pit_id
    const bookingIds = [...new Set(hits.map(hit => hit._source.bookingId))]
    const bookings = await $query('Booking')
      .containedIn('objectId', bookingIds)
      .include(['deleted', 'company'])
      .limit(bookingIds.length)
      .find({ useMasterKey: true })
    for (const hit of hits) {
      const booking = bookings.find(obj => obj.id === hit._source.bookingId)
      if (!booking) { continue }
      const row = {
        ...booking.attributes,
        orderNo: booking.get('no'),
        companyName: booking.get('company').get('name'),
        objectId: booking.get('cube').id,
        ...booking.get('cube').attributes,
        htCode: housingTypes[booking.get('cube').get('ht')?.id]?.name || booking.get('cube').get('hti') || booking.get('cube').get('media') || '',
        stateName: states[booking.get('cube').get('state').id]?.name || '',
        ...getCubeOrderDates(booking.get('cube'), booking.attributes),
        periodStart: dateString(req.query.f),
        periodEnd: dateString(req.query.t),
        autoExtends: booking.get('autoExtendsBy')
          ? booking.get('canceledAt') ? 'nein (gekündigt)' : 'ja'
          : 'nein'
      }

      const { pricingModel, commission, fixedPrice, fixedPriceMap } = booking.get('company').get('distributor')

      if (pricingModel === 'commission' && commission) {
        row.monthlyEnd = booking.get('endPrices')?.[row.objectId] || 0
        row.distributorRate = commission
        const distributorRatio = round5(row.distributorRate / 100)
        row.monthlyDistributor = round2(row.monthlyEnd * distributorRatio)
        row.monthly = round2(row.monthlyEnd - row.monthlyDistributor)
      }
      if (pricingModel === 'fixed') {
        row.monthly = fixedPrice || fixedPriceMap[row.media]
      }
      if (!pricingModel && booking.get('monthlyMedia')?.[row.objectId]) {
        row.monthly = booking.get('monthlyMedia')?.[row.objectId]
      }

      if (req.query.f && req.query.t) {
        row.months = moment(req.query.t).add(1, 'days').diff(req.query.f, 'months', true)
        row.total = round2(row.monthly * (row.months || 0))
      }
      worksheet.addRow(row)
    }
    count += hits.length
    if (hits.length < size) {
      break
    }
    // search after has to provide value for each sort
    const lastHit = hits[hits.length - 1]
    searchAfter = lastHit.sort
  }
  await elastic.closePointInTime({ id: pointInTimeId })

  const colSumFormula = `SUM(INDIRECT(ADDRESS(2,COLUMN(),4)):INDIRECT(ADDRESS(${count + 1},COLUMN(),4)))`
  const totalRow = worksheet.addRow({
    monthly: { formula: colSumFormula },
    total: { formula: colSumFormula }
  })
  totalRow.height = 24
  totalRow.font = { bold: true, size: 12 }

  worksheet.commit()

  const buffer = await new Promise((resolve, reject) => {
    workbook.commit().then(() => {
      const stream = workbook.stream
      const result = stream.read()
      resolve(result)
    }).catch((e) => {
      reject(e)
    })
  })
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition('Meine Buchungen', 'xlsx'))
  res.set('Content-Length', buffer.length)
  return res.send(buffer)
}))

router.get('/contract-extend-pdf', handleErrorAsync(async (req, res) => {
  const contract = await $getOrFail('Contract', req.query.id)
  const fileId = await generateContractExtend(contract, req.query.fixedPricesUpdated)
  const response = await drive.files.export({ fileId, mimeType: 'application/pdf' }, { responseType: 'stream' })
  return response.data
    .on('error', consola.error)
    .pipe(res)
    .on('error', consola.error)
    .on('finish', () => {
      res.status(200).end()
      drive.files.delete({ fileId })
    })
}))

router.get('/invoice-pdf', handleErrorAsync(async (req, res) => {
  const invoice = await $query('Invoice').equalTo('lexId', req.query.id).first({ useMasterKey: true })
  if (!invoice) {
    throw new Error('Rechnung nicht gefunden')
  }
  let lexNo = invoice.get('lexNo')
  let lexDocumentFileId = invoice.get('lexDocumentFileId')

  while (!lexNo || !lexDocumentFileId) {
    const lexDocument = await getLexInvoiceDocument(req.query.id)
    if (lexDocument) {
      if (lexDocument.status === 404) {
        throw new Error('Rechnungsdokument nicht gefunden')
      }
      lexNo = lexDocument.voucherNumber
      lexDocumentFileId = lexDocument.files?.documentFileId
    }
  }
  try {
    const response = await getLexFile(lexDocumentFileId)
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', `inline; filename="${lexNo}.pdf"`)
    return res.send(response.buffer)
  } catch (error) {
    consola.error(error.status, error.data)
    throw new Error(error.data?.message || error.text || 'Unknown LexApi Error')
  }
}))

router.get('/credit-note-pdf', handleErrorAsync(async (req, res) => {
  const creditNote = await $query('CreditNote').equalTo('lexId', req.query.id).first({ useMasterKey: true })
  if (!creditNote) {
    throw new Error('Gutschrift nicht gefunden')
  }
  let lexNo = creditNote.get('lexNo')
  let lexDocumentFileId = creditNote.get('lexDocumentFileId')

  while (!lexNo || !lexDocumentFileId) {
    const lexDocument = await getLexCreditNoteDocument(req.query.id)
    if (lexDocument) {
      if (lexDocument.status === 404) {
        throw new Error('Gutschriftsdokument nicht gefunden')
      }
      lexNo = lexDocument.voucherNumber
      lexDocumentFileId = lexDocument.files?.documentFileId
    }
  }
  try {
    const response = await getLexFile(lexDocumentFileId)
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', `inline; filename="${lexNo}.pdf"`)
    return res.send(response.buffer)
  } catch (error) {
    throw new Error(error.data.message)
  }
}))

router.get('/assembly-instructions-pdf', handleErrorAsync(async (req, res) => {
  const production = await $getOrFail('Production', req.query.production)
  const url = `${process.env.WEBAPP_URL}/assembly-instructions/${production.id}?sid=${req.sessionToken}`
  const fetchResponse = await fetch(process.env.HTML_TO_PDF_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      pdfOptions: { timeout: 0 },
      timeout: 30 * 60 * 1000 // 30 minutes navigation timeout
    })
  })
  if (fetchResponse.ok) {
    res.setHeader('Content-Type', 'application/pdf')
    const filename = (production.get('contract') || production.get('booking')).get('no') + ' Montageanweisung'
    res.setHeader('Content-Disposition', getAttachmentContentDisposition(filename, 'pdf'))
    fetchResponse.body.pipe(res)
    return
  }
  console.error('FETCH ERRORED')
  console.error(fetchResponse)
  res.status(fetchResponse.status).send(fetchResponse)
}))

router.get('/offer-pdf', handleErrorAsync(async (req, res) => {
  const offer = await $getOrFail('Offer', req.query.id)
  const url = `https://city-cubes.de/op/${req.query.id}?sid=${req.sessionToken}`
  const fetchResponse = await fetch(process.env.HTML_TO_PDF_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      pdfOptions: { timeout: 0 },
      timeout: 30 * 60 * 1000 // 30 minutes navigation timeout
    })
  })
  if (fetchResponse.ok) {
    res.setHeader('Content-Type', 'application/pdf')
    let filename = 'Angebot ' + offer.get('no')
    if (offer.status < 1) {
      filename += ' (In Bearbeitung)'
    }
    res.setHeader('Content-Disposition', getAttachmentContentDisposition(filename, 'pdf'))
    fetchResponse.body.pipe(res)
    return
  }
  console.error('FETCH ERRORED')
  console.error(fetchResponse)
  res.status(fetchResponse.status).send(fetchResponse)
}))

router.get('/cube-mismatches', handleErrorAsync(async (req, res) => {
  const workbook = new excel.Workbook()
  const fields = {
    cubeId: { header: 'Gehäusetyp', width: 20 },
    // str: { header: 'Straße', width: 15 },
    // hsnr: { header: 'Hausnummer', width: 15 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 25 },
    stateName: { header: 'Bundesland', width: 20 },
    nominatimState: { header: 'Geo Bundesland', width: 20 },
    taskListCount: { header: 'Abfahrtsliste', width: 20 }
  }
  const { columns, headerRowValues } = getColumnHeaders(fields)

  const states = await $query('State').find({ useMasterKey: true })

  function getStateName ({ state, 'ISO3166-2-lvl4': isoCode }) {
    if (state) {
      return state
    }
    if (isoCode) {
      return states.find(({ id }) => id === isoCode.split('-')[1]).get('name')
    }
    return null
  }

  for (const state of states) {
    const stateName = state.get('name')
    const isoCode = 'DE-' + state.id
    const worksheet = workbook.addWorksheet(stateName)
    worksheet.columns = columns
    const headerRow = worksheet.addRow(headerRowValues)
    headerRow.font = { name: 'Calibri', bold: true, size: 9 }
    headerRow.height = 24

    const stateMismatchQuery = Parse.Query.or(
      $query('Cube').notEqualTo('nominatimAddress.ISO3166-2-lvl4', null).notEqualTo('nominatimAddress.ISO3166-2-lvl4', isoCode),
      $query('Cube').notEqualTo('nominatimAddress.state', null).notEqualTo('nominatimAddress.state', stateName)
    )

    let i = 0
    let tl = 0
    await stateMismatchQuery
      .equalTo('state', state)
      .notEqualTo('nominatimAddress', null)
      .select(['plz', 'ort', 'state', 'nominatimAddress'])
      .eachBatch(async (cubes) => {
        for (const cube of cubes) {
          const nominatimAddress = cube.get('nominatimAddress')
          const shouldState = getStateName(nominatimAddress)
          if (shouldState === stateName) { continue }
          const taskListIds = await $query('TaskList').equalTo('cubeIds', cube.id).distinct('objectId', { useMasterKey: true })
          taskListIds.length && consola.warn(taskListIds.length)
          worksheet.addRow({
            cubeId: cube.id,
            ...cube.attributes,
            stateName,
            nominatimState: shouldState,
            taskListCount: `${taskListIds.length || ''}`
          })
          taskListIds.length && (tl += taskListIds.length)
          i++
        }
      }, { useMasterKey: true })
    if (i === 0) {
      workbook.removeWorksheet(worksheet.id)
      continue
    }
    console.log(stateName, tl)
    worksheet.name = `${stateName} ${i}` + (tl ? ` (${tl})` : '')
  }
  const filename = 'Wrong Bundesländer'
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', getAttachmentContentDisposition(filename, 'xlsx'))
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

module.exports = router
