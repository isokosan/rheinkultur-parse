require('./globals')
const express = require('express')
const router = express.Router()

const Parse = require('parse/node')
Parse.serverURL = process.env.PUBLIC_SERVER_URL
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)

const excel = require('exceljs')

const elastic = require('@/services/elastic')
const { drive } = require('@/services/googleapis')
const { getLexFile, getLexInvoiceDocument, getLexCreditNoteDocument } = require('@/services/lex')
const { getCubeSummaries } = require('@/shared')
const { round2, dateString, durationString } = require('@/utils')
const { fetchHousingTypes } = require('@/cloud/classes/housing-types')
const { fetchStates } = require('@/cloud/classes/states')
const { generateContractExtend } = require('@/docs')
const { CUBE_STATUSES, CUBE_FEATURES } = require('@/schema/enums')

const handleErrorAsync = func => (req, res, next) => func(req, res, next).catch((error) => next(error))

const safeName = name => name.replace(/\//g, '').replace(/\s\s+/g, ' ').replace(/,/g, '').trim()

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
const alignRight = { alignment: { horizontal: 'right' } }
const dateStyle = { numFmt: 'dd.mm.yyyy', ...alignRight }
const priceStyle = { numFmt: '#,##0.00 "€";[Red]-#,##0.00 "€"', ...alignRight }
const percentStyle = { numFmt: '#.##"%";#.##"%";""', ...alignRight }
const monthsStyle = { numFmt: '#.####', ...alignRight }
const numberStyle = { numFmt: '#,####', ...alignRight }

router.get('/cubes', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.stream.xlsx.WorkbookWriter({ useStyles: true })
  const worksheet = workbook.addWorksheet('CityCubes')

  const fields = {
    objectId: { header: 'CityCube ID',width: 30 },
    verified: { header: 'Verifiziert', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    str: { header: 'Straße', width: 15 },
    hsnr: { header: 'Hausnummer', width: 15 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 15 },
    stateName: { header: 'Bundesland', width: 20 },
    lat: { header: 'Breite', width: 13 },
    lon: { header: 'Länge', width: 13 }
  }
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
      if (doc.scoutData) {
        for (const key of Object.keys(CUBE_FEATURES)) {
          doc[key] = CUBE_FEATURES[key].values[doc.scoutData[key]] || ''
        }
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
  res.set('Content-Disposition', 'attachment; filename=Cubes.xlsx')
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
  res.set('Content-Disposition', `attachment; filename=${safeName(filename)}.xlsx`)
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

const startOfUtcDate = val => val ? moment.utc(val).startOf('day').toDate() : undefined

function getCubeOrderDates (cube, order) {
  const { startsAt, endsAt, earlyCancellations, initialDuration, extendedDuration } = order.attributes
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
  return monthlyMedia[cube.id]
}

async function getContractRows (contract, { housingTypes, states }, exportCubeIds) {
  const rows = []
  const { motive, externalOrderNo, campaignNo, cubeIds } = contract.attributes
  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  const printPackages = production?.get('printPackages') || {}
  exportCubeIds = exportCubeIds ? exportCubeIds.filter(id => cubeIds.includes(id)) : cubeIds
  const cubes = await $query('Cube').containedIn('objectId', exportCubeIds).limit(exportCubeIds.length).find({ useMasterKey: true })
  for (const cube of cubes) {
    const { start, end, duration, canceledEarly } = getCubeOrderDates(cube, contract)
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
      canceledEarly
    })
  }
  return rows
}

// http://localhost:1337/exports/contract/AsaJNA61xX
router.get('/contract/:contractId', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.Workbook()

  const { columns, headerRowValues } = getColumnHeaders({
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnennr.', width: 20 },
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
    monthly: { header: 'Monatsmiete', width: 15, style: priceStyle },
    pp: { header: 'Belegungspaket', width: 20 }
  })

  const contract = await $getOrFail('Contract', req.params.contractId)
  const cubeIds = req.query.cubeIds ? decodeURIComponent(req.query.cubeIds || '').split(',') : null
  const worksheet = workbook.addWorksheet(safeName(contract.get('no')))
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24

  const rows = await getContractRows(contract, { housingTypes, states }, cubeIds)
  for (const item of rows) {
    const row = worksheet.addRow(item)
    item.canceledEarly && (row.getCell(12).font = { name: 'Calibri', color: { argb: 'ff2222' } })
    item.canceledEarly && (row.getCell(13).font = { name: 'Calibri', color: { argb: 'ff2222' } })
  }

  const filename = `Vertrag ${contract.get('no')} (Stand ${moment().format('DD.MM.YYYY')})`
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename=${safeName(filename)}.xlsx`)
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

// http://localhost:1337/exports/company/FNFCxMgEEr
router.get('/company/:companyId', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.Workbook()

  const company = await $getOrFail('Company', req.params.companyId)
  const { columns, headerRowValues } = getColumnHeaders({
    orderNo: { header: 'Auftragsnr.', width: 20 },
    motive: { header: 'Motiv', width: 20 },
    externalOrderNo: { header: 'Extern. Auftragsnr.', width: 20 },
    campaignNo: { header: 'Kampagnennr.', width: 20 },
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
    autoExtends: { header: 'A-V', width: 15, style: alignRight },
    monthly: { header: 'Monatsmiete', width: 15, style: priceStyle },
    pp: { header: 'Belegungspaket', width: 20 }
  })

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
      rows.push(...await getContractRows(contract, { housingTypes, states }))
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
  res.set('Content-Disposition', `attachment; filename=${safeName(filename)}.xlsx`)
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/assembly-list', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const production = await $getOrFail('Production', req.query.id, ['booking', 'contract'])
  const bookingOrContract = await production.get('booking') || production.get('contract')
  const company = await bookingOrContract.get('company').fetch({ useMasterKey: true })

  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('CityCubes')

  const period = [bookingOrContract.get('startsAt'), bookingOrContract.get('endsAt')]
    .map(d => moment(d).format('DD.MM.YYYY')).join(' - ')

  const infos = [
    { label: 'Kunde', content: company?.get('name') || '-' },
    { label: 'Produkt / Medium', content: 'CityCubes' },
    { label: 'Belegungsart', content: '' },
    { label: 'Werbemittel', content: '' },
    { label: 'Buchungszeitraum', content: `${period} (${bookingOrContract.get('initialDuration')} Monate)` },
    { label: 'Lieferung der Druckdaten', content: `bis spätestens ${moment(production.get('printFilesDue')).format('DD.MM.YYYY')}` },
    { label: 'Montagebeginn:', content: `ab ${moment(production.get('assemblyStart')).format('DD.MM.YYYY')}` }
  ]
  bookingOrContract?.get('motive') && infos.push({ label: 'Motiv', content: bookingOrContract.get('motive') })
  bookingOrContract?.get('campaignNo') && infos.push({ label: 'Kampagnennummer.', content: bookingOrContract.get('campaignNo') })
  bookingOrContract?.get('externalOrderNo') && infos.push({ label: 'Extern. Auftragsnr.', content: bookingOrContract.get('externalOrderNo') })

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

  const { columns, headerRowValues } = getColumnHeaders({
    assemblyStart: { header: 'Erschließungstermin\n(bis spätestens)', width: 30 },
    stateName: { header: 'Bundesland', width: 20 },
    plz: { header: 'PLZ', width: 10 },
    ort: { header: 'Ort', width: 20 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 10 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    comments: { header: 'Bemerkungen', width: 20 },
    ppMaterial: { header: 'Belegung Material', width: 20 },
    ppNo: { header: 'Belegungsnummer', width: 10 },
    x1: { header: 'Strassenzugewandte Front\n(Tür - oder Rückseite)', width: 20 },
    x2: { header: 'Rest Streichen\n(wenn nötig)', width: 20 },
    x3: { header: 'Volumenpreis (EK)', width: 20 },
    // printName: { header: 'Belegungsnummer', width: 10 },
    assembler: { header: 'Wer montiert', width: 20 }
  })
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 8 }
  headerRow.height = 40
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

  const printPackages = production.get('printPackages')
  const cubeIds = Object.keys(printPackages)
  const cubes = await $query('Cube')
    .containedIn('objectId', cubeIds)
    .limit(cubeIds.length)
    .find({ useMasterKey: true })
  for (const cube of cubes) {
    const { str, hsnr, plz, ort, ht, state } = cube.attributes
    const pp = printPackages[cube.id]
    consola.info(pp)
    worksheet.addRow({
      assemblyStart: production.get('assemblyStart'),
      objectId: cube.id,
      stateName: states[state.id]?.name || '',
      htCode: housingTypes[ht.id]?.code || '',
      str,
      hsnr,
      plz,
      ort,
      ppNo: pp?.no || '-',
      ppMaterial: pp?.type || '-',
      comments: production.get('printNotes')?.[cube.id],
      x1: 'X',
      x2: 'X',
      assembler: production.get('assembler') || '-'
    })
  }
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const contractOrBooking = production.get('contract') || production.get('booking')
  res.set('Content-Disposition', 'attachment; filename=' + contractOrBooking.get('no') + '.xlsx')
  return workbook.xlsx.write(res).then(function () {
    res.status(200).end()
  })
}))

router.get('/control', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  let isAldi = false
  const aldiTagIds = await (new Parse.Query('Tag')).containedIn('name', ['ALDI', 'ALDI Süd', 'ALDI Nord']).distinct('objectId', { useMasterKey: true })
  // control list might be for a single control list, or a control with many control lists
  const { id, controlId } = req.query
  const query = new Parse.Query('TaskList')
  id && query.equalTo('objectId', id)
  if (controlId) {
    const control = await (new Parse.Query('Control')).equalTo('objectId', controlId).first({ useMasterKey: true })
    query.equalTo('control', control)
    if (control.get('source').className === 'Company') {
      const company = await control.get('source')
      if ((company.get('tags') || []).includes(tag => aldiTagIds.includes(tag.id))) {
        isAldi = true
      }
    }
    if (control.get('source').className === 'Tag') {
      if (aldiTagIds.includes(control.get('source').id)) {
        isAldi = true
      }
    }
  }

  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('Kontrolliste')
  const { columns, headerRowValues } = getColumnHeaders({
    cbNo: { header: 'Vertragsnr.', width: 20 },
    companyName: { header: 'Kunde', width: 20 },
    externalOrderNo: { header: isAldi ? 'VST' : 'Auftragsnr.', width: 20 },
    campaignNo: { header: isAldi ? 'Regional-gesellschaft' : 'Kampagne', width: 20 },
    motive: { header: 'Kunde/Motiv', width: 20 },
    stateName: { header: 'Bundesland', width: 30 },
    plz: { header: 'PLZ', width: 15 },
    ort: { header: 'Ort', width: 15 },
    str: { header: 'Straße', width: 20 },
    hsnr: { header: 'Hsnr.', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    startsAt: { header: 'Startdatum', width: 20, style: dateStyle },
    endsAt: { header: 'Enddatum', width: 20, style: dateStyle }
  })
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24

  let skip = 0
  while (true) {
    const taskLists = await query.limit(10).skip(skip).find({ useMasterKey: true })
    if (!taskLists.length) {
      break
    }
    skip += taskLists.length
    for (const taskList of taskLists) {
      const cubeIds = taskList.get('cubeIds') || []
      const cubes = await $query('Cube')
        .containedIn('objectId', cubeIds)
        .limit(cubeIds.length)
        .find({ useMasterKey: true })
      for (const cube of cubes) {
        const contractOrBooking = await $getOrFail(cube.get('order').className, cube.get('order').objectId, ['company'])
        worksheet.addRow({
          objectId: cube.id,
          cbNo: contractOrBooking.get('no'),
          companyName: contractOrBooking.get('company')?.get('name'),
          externalOrderNo: contractOrBooking.get('externalOrderNo'),
          campaignNo: contractOrBooking.get('campaignNo'),
          motive: contractOrBooking.get('motive'),
          htCode: housingTypes[cube.get('ht')?.id]?.code || '',
          str: cube.get('str'),
          hsnr: cube.get('hsnr'),
          plz: cube.get('plz'),
          ort: cube.get('ort'),
          stateName: states[cube.get('state')?.id]?.name || '',
          startsAt: startOfUtcDate(contractOrBooking.get('startsAt')),
          endsAt: startOfUtcDate(cube.get('order').endsAt)
        })
      }
    }
  }
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', 'attachment; filename=Kontrolliste.xlsx')
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

const addTaskListSheet = async (workbook, taskList) => {
  const parent = taskList.get('briefing') || taskList.get('control') || taskList.get('disassembly').get('order')
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
    address: { header: 'Anschrift', width: 30 },
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
  const cubes = await (new Parse.Query('Cube'))
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
      address: cube.get('str') + ' ' + cube.get('hsnr'),
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
        address: doc.str + ' ' + doc.hsnr,
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
    .include(['state', 'briefing', 'control', 'disassembly', 'disassembly.booking', 'disassembly.contract'])
    .get(req.query.id, { useMasterKey: true })
  const parent = taskList.get('briefing') || taskList.get('control') || taskList.get('disassembly')
  let name = parent.get('name') || parent.get('booking')?.get('no') || parent.get('contract')?.get('no')
  if (taskList.get('type') === 'disassembly') {
    name = 'Demontage ' + name
  }
  const workbook = new excel.Workbook()
  await addTaskListSheet(workbook, taskList)
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename=${name} ${taskList.get('ort')}.xlsx`)
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
    parentQuery.equalTo(orderClass.toLowerCase(), order)
  } else {
    const objectId = req.query.parent.replace(`${className}-`, '')
    parentQuery.equalTo('objectId', objectId)
    name = await parentQuery.first({ useMasterKey: true }).then(parent => parent.get('name'))
  }
  const workbook = new excel.Workbook()
  await $query('TaskList')
    .matchesQuery(className.toLowerCase(), parentQuery)
    .include('state')
    .each(async taskList => {
      await addTaskListSheet(workbook, taskList)
    }, { useMasterKey: true })
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename=${name}.xlsx`)
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/disassemblies', handleErrorAsync(async (req, res) => {
  const { start: from, end: to } = req.query

  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet(safeName(`Demontageliste ${[moment(from).format('DD.MM.YYYY'), moment(to).format('DD.MM.YYYY')].join('-')}`))

  const { columns, headerRowValues } = getColumnHeaders({
    orderNo: { header: 'Auftragsnr.', width: 20 },
    customerName: { header: 'Kunde', width: 20 },
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    address: { header: 'Anschrift', width: 30 },
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
      const cubes = await (new Parse.Query('Cube'))
        .containedIn('objectId', cubeIds)
        .include(['ht', 'state'])
        .limit(cubeIds.length)
        .find({ useMasterKey: true })
      for (const cube of cubes) {
        worksheet.addRow({
          orderNo: order.get('no'),
          customerName: order.get('company')?.get('name'),
          objectId: cube.id,
          htCode: cube.get('ht')?.get('code') || cube.get('hti'),
          address: cube.get('str') + ' ' + cube.get('hsnr'),
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
  res.set('Content-Disposition', `attachment; filename=Demontage ${req.params.monthYear}.xlsx`)
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
  const filename = `${invoice.get('lexNo') || ''} Rechnungsdetails`.trim()
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename=${safeName(filename)}.xlsx`)
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
    campaignNo: { header: 'Kampagnennr.', width: 20 },
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
  res.set('Content-Disposition', `attachment; filename=${safeName(filename)}.xlsx`)
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/contract-extend-pdf/:contractId', handleErrorAsync(async (req, res) => {
  const { contractId } = req.params
  const contract = await $getOrFail('Contract', contractId)
  const fileId = await generateContractExtend(contract)
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

router.get('/invoice-pdf/:resourceId', handleErrorAsync(async (req, res) => {
  const lexDocument = await getLexInvoiceDocument(req.params.resourceId)
  const response = await getLexFile(lexDocument.files.documentFileId)
  res.set('Content-Type', 'application/pdf')
  res.set('Content-Disposition', `inline; filename="${lexDocument.voucherNumber}.pdf"`)
  return res.send(response.buffer)
}))

router.get('/credit-note-pdf/:resourceId', handleErrorAsync(async (req, res) => {
  const lexDocument = await getLexCreditNoteDocument(req.params.resourceId)
  const response = await getLexFile(lexDocument.files.documentFileId)
  res.set('Content-Type', 'application/pdf')
  res.set('Content-Disposition', `inline; filename="${lexDocument.voucherNumber}.pdf"`)
  return res.send(response.buffer)
}))

module.exports = router
