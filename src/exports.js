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
const { round2, durationString } = require('@/utils')
const { fetchHousingTypes } = require('@/cloud/classes/housing-types')
const { fetchStates } = require('@/cloud/classes/states')
const { generateContractExtend } = require('@/docs')
const { CUBE_STATUSES } = require('@/schema/enums')

const handleErrorAsync = func => (req, res, next) => func(req, res, next).catch((error) => next(error))

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

router.get('/cubes', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.stream.xlsx.WorkbookWriter({})
  const worksheet = workbook.addWorksheet('CityCubes')
  worksheet.columns = [
    { header: 'CityCube ID', key: 'objectId', width: 30 },
    { header: 'Verifiziert', key: 'verified', width: 20 },
    { header: 'Gehäusetyp', key: 'htCode', width: 20 },
    { header: 'Straße', key: 'str', width: 15 },
    { header: 'Hausnummer', key: 'hsnr', width: 15 },
    { header: 'PLZ', key: 'plz', width: 10 },
    { header: 'Ort', key: 'ort', width: 15 },
    { header: 'Bundesland', key: 'stateName', width: 20 },
    { header: 'Breite', key: 'lat', width: 12 },
    { header: 'Länge', key: 'lon', width: 12 }
  ]

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
      doc.htCode = housingTypes[doc.htId]?.code || doc.hti
      doc.stateName = states[doc.stateId]?.name || ''
      doc.lat = doc.gp.latitude
      doc.lon = doc.gp.longitude
      return doc
    })) {
      worksheet.addRow(row).commit()
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

function getCubeOrderDates (cube, order) {
  const { startsAt, endsAt, earlyCancellations, initialDuration, extendedDuration } = order.attributes
  const earlyCanceledAt = earlyCancellations?.[cube.id]
  if (earlyCanceledAt === true) {
    return { duration: '0' }
  }
  return {
    start: moment(startsAt).format('DD.MM.YYYY'),
    end: moment(earlyCanceledAt || endsAt).format('DD.MM.YYYY'),
    duration: earlyCanceledAt
      ? durationString(earlyCanceledAt, startsAt)
      : [initialDuration, extendedDuration].filter(x => x).join('+')
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

async function getContractRows (contract, { housingTypes, states }) {
  const rows = []
  const { motive, externalOrderNo, campaignNo, cubeIds } = contract.attributes
  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  const printPackages = production?.get('printPackages') || {}
  const cubes = await $query('Cube').containedIn('objectId', cubeIds).limit(cubeIds.length).find({ useMasterKey: true })
  for (const cube of cubes) {
    const { start, end, duration } = getCubeOrderDates(cube, contract)
    const monthly = getCubeMonthlyMedia(cube, contract)
    rows.push({
      objectId: cube.id,
      motive,
      externalOrderNo,
      campaignNo,
      htCode: housingTypes[cube.get('ht')?.id]?.code || cube.get('hti'),
      str: cube.get('str'),
      hsnr: cube.get('hsnr'),
      plz: cube.get('plz'),
      ort: cube.get('ort'),
      stateName: states[cube.get('state')?.id]?.name || '',
      start,
      end,
      duration,
      monthly,
      pp: [printPackages[cube.id]?.no, printPackages[cube.id]?.name].filter(x => x).join(': ')
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
  const worksheet = workbook.addWorksheet(contract.get('no'))
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24
  worksheet.addRows(await getContractRows(contract, { housingTypes, states }))
  const filename = `Vertrag ${contract.get('no')} (Stand ${moment().format('DD.MM.YYYY')})`
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename=${filename}.xlsx`)
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

// http://localhost:1337/exports/company/FNFCxMgEEr
router.get('/company/:companyId', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const workbook = new excel.Workbook()

  const company = await $getOrFail('Company', req.params.companyId)
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

  await $query('Contract').equalTo('company', company).equalTo('status', 3).each(async (contract) => {
    const worksheet = workbook.addWorksheet(contract.get('no'))
    worksheet.columns = columns
    const headerRow = worksheet.addRow(headerRowValues)
    headerRow.font = { name: 'Calibri', bold: true, size: 12 }
    headerRow.height = 24
    const rows = await getContractRows(contract, { housingTypes, states })
    worksheet.addRows(rows)
  }, { useMasterKey: true })

  const nameOrder = workbook.worksheets.map(sheet => sheet.name).sort((a, b) => b.localeCompare(a))
  workbook.eachSheet((sheet) => { sheet.orderNo = nameOrder.indexOf(sheet.name) })
  const filename = `Laufende Verträge ${company.get('name')} (Stand ${moment().format('DD.MM.YYYY')})`
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename=${filename}.xlsx`)
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/assembly-list', handleErrorAsync(async (req, res) => {
  const housingTypes = await fetchHousingTypes()
  const states = await fetchStates()
  const production = await (new Parse.Query('Production')).get(req.query.id, { useMasterKey: true })
  const printTemplates = production.get('printTemplates')
  const cubes = await (new Parse.Query('Cube'))
    .containedIn('objectId', Object.keys(printTemplates))
    .limit(1000)
    .find()
  const rows = []
  for (const cube of cubes) {
    const { str, hsnr, plz, ort, ht, state } = cube.attributes
    const printPackage = production.get('printPackages')[cube.id]
    const { objectId: ppId, no, name } = printPackage
    rows.push({
      objectId: cube.id,
      htCode: housingTypes[ht.id]?.code || '',
      str,
      hsnr,
      plz,
      ort,
      stateName: states[state.id]?.name || '',
      pp: [no, name].filter(x => x).join(' - '),
      templates: process.env.WEBAPP_URL + '/pp/' + ppId + '?ht=' + ht.id
    })
  }
  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet('CityCubes')
  worksheet.columns = [
    {
      header: 'CityCube ID',
      key: 'objectId',
      width: 15
    },
    {
      header: 'Gehäusetyp',
      key: 'htCode',
      width: 15
    },
    {
      header: 'Stadt',
      key: 'ort',
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
      header: 'Bundesland',
      key: 'stateName',
      style: {
        alignment: { shrinkToFit: true }
      },
      width: 20
    },
    { header: 'Belegungspaket', key: 'pp', width: 25 },
    { header: 'Druckspezifikationen', key: 'templates', width: 30 }
  ]
  worksheet.addRows(rows)
  const headerRow = worksheet.getRow(1)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24
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
  const query = new Parse.Query('DepartureList')
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
    const departureLists = await query.limit(10).skip(skip).find({ useMasterKey: true })
    if (!departureLists.length) {
      break
    }
    skip += departureLists.length
    for (const departureList of departureLists) {
      const cubeIds = departureList.get('cubeIds') || []
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
          startsAt: contractOrBooking.get('startsAt')
            ? moment(contractOrBooking.get('startsAt')).format('DD.MM.YYYY')
            : '-',
          endsAt: moment(cube.get('order').endsAt).format('DD.MM.YYYY')
        })
      }
    }
  }
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', 'attachment; filename=Kontrolliste.xlsx')
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/departure-lists', handleErrorAsync(async (req, res) => {
  const [className, objectId] = req.query.parent.split('-')
  const parent = await $getOrFail(className, objectId)
  const workbook = new excel.Workbook()
  await $query('DepartureList')
    .equalTo(className.toLowerCase(), parent)
    .each(async departureList => {
      const worksheet = workbook.addWorksheet(`${departureList.get('ort')} (${departureList.get('state').id})`)
      const { columns, headerRowValues } = getColumnHeaders({
        objectId: { header: 'CityCube ID', width: 20 },
        htCode: { header: 'Gehäusetyp', width: 20 },
        status: { header: 'Status', width: 15 },
        address: { header: 'Anschrift', width: 30 },
        plz: { header: 'PLZ', width: 15 },
        ort: { header: 'Ort', width: 15 },
        stateName: { header: 'Bundesland', width: 30 }
      })
      worksheet.columns = columns
      const headerRow = worksheet.addRow(headerRowValues)
      headerRow.font = { name: 'Calibri', bold: true, size: 12 }
      headerRow.height = 24

      const cubeIds = departureList.get('cubeIds') || []
      const cubes = await (new Parse.Query('Cube'))
        .containedIn('objectId', cubeIds)
        .include(['ht', 'state'])
        .limit(cubeIds.length)
        .find({ useMasterKey: true })
      for (const cube of cubes) {
        const row = worksheet.addRow({
          objectId: cube.id,
          htCode: cube.get('ht')?.get('code') || cube.get('hti'),
          status: CUBE_STATUSES[cube.get('s') || 0],
          address: cube.get('str') + ' ' + cube.get('hsnr'),
          plz: cube.get('plz'),
          ort: cube.get('ort'),
          stateName: cube.get('state').get('name')
        })
        !cube.get('ht') && (row.getCell(2).font = { name: 'Calibri', color: { argb: '808080' } })
        cube.get('s') !== 0 && (row.getCell(3).font = { name: 'Calibri', color: { argb: 'ff2222' } })
      }
    }, { useMasterKey: true })
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename=Alle Abfahrtsliste ${parent.get('name')}.xlsx`)
  return workbook.xlsx.write(res).then(function () { res.status(200).end() })
}))

router.get('/departure-list', handleErrorAsync(async (req, res) => {
  const departureList = await (new Parse.Query('DepartureList')).include('company').get(req.query.id, { useMasterKey: true })
  const workbook = new excel.Workbook()
  const worksheet = workbook.addWorksheet(departureList.get('name'))

  const infos = [
    { label: 'Auftraggeber', content: departureList.get('company')?.get('name') || '-' },
    { label: 'Abfahrtsliste', content: departureList.get('name') },
    { label: 'Fälligkeitsdatum', content: departureList.get('dueDate') ? moment(departureList.get('dueDate')).format('DD.MM.YYYY') : '' }
  ]
  if (departureList.get('type') === 'scout') {
    infos.push({ label: 'Anzahl', content: departureList.get('quota') || 'Alle' })
  }

  let i = 1
  for (const info of infos) {
    const row = worksheet.getRow(i)
    row.values = [info.label, info.content]
    row.height = 24
    row.getCell(1).font = { bold: true }
    i++
  }
  worksheet.addRow()
  i++

  const { columns, headerRowValues } = getColumnHeaders({
    objectId: { header: 'CityCube ID', width: 20 },
    htCode: { header: 'Gehäusetyp', width: 20 },
    hti: { header: 'Gehäusetyp TLK', width: 20 },
    address: { header: 'Anschrift', width: 30 },
    plz: { header: 'PLZ', width: 15 },
    ort: { header: 'Ort', width: 15 },
    stateName: { header: 'Bundesland', width: 30 }
  })
  worksheet.columns = columns
  const headerRow = worksheet.addRow(headerRowValues)
  headerRow.font = { name: 'Calibri', bold: true, size: 12 }
  headerRow.height = 24

  const cubeIds = departureList.get('cubeIds') || []
  const cubes = await (new Parse.Query('Cube'))
    .containedIn('objectId', cubeIds)
    .include(['ht', 'state'])
    .limit(cubeIds.length)
    .find({ useMasterKey: true })
  for (const cube of cubes) {
    const row = worksheet.addRow({
      objectId: cube.id,
      htCode: cube.get('ht')?.get('code'),
      hti: cube.get('hti'),
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
  const query = departureList.get('briefing') && departureList.get('cubesQuery')
  if (query) {
    query.s = 'available'
    query.pagination = 1000
    const { results } = await Parse.Cloud.run('search', query, { useMasterKey: true })
    for (const doc of results) {
      if (cubeIds.includes(doc.objectId)) {
        continue
      }
      worksheet.addRow({
        objectId: doc.objectId,
        htCode: housingTypes[doc.ht?.id]?.code || '',
        hti: doc.hti,
        address: doc.str + ' ' + doc.hsnr,
        plz: doc.plz,
        ort: doc.ort,
        stateName: states[doc.stateId]?.name || ''
      })
    }
  }
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename=Abfahrtsliste ${departureList.get('name')}.xlsx`)
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
    periodStart: row.periodStart ? moment(row.periodStart).format('DD.MM.YYYY') : '',
    periodEnd: row.periodEnd ? moment(row.periodEnd).format('DD.MM.YYYY') : ''
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
  res.set('Content-Disposition', `attachment; filename=${filename}.xlsx`)
  return workbook.xlsx.write(res).then(function () {
    res.status(200).end()
  })
}))

router.get('/quarterly-reports/:quarter', handleErrorAsync(async (req, res) => {
  const { quarter } = req.params
  const { distributorId, agencyId, regionId, lessorCode } = req.query
  const report = await $query('QuarterlyReport')
    .equalTo('quarter', quarter)
    .descending('createdAt')
    .include('rows')
    .first({ useMasterKey: true })

  let filename = `Auftragsliste ${quarter}`
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
    monthly: { header: 'Monatsmiete', width: 12, style: priceStyle },
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
    invoiceNo: { header: 'Rechnungsnr.', width: 20 }
  }

  if (distributorId) {
    const distributorName = await $getOrFail('Company', distributorId).then((company) => company.get('name'))
    filename = `${distributorName} ${quarter}`
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
    delete fields.invoiceNo
  }
  if (agencyId) {
    const agencyName = await $getOrFail('Company', agencyId).then((company) => company.get('name'))
    filename = `${agencyName} ${quarter}`
    delete fields.regionalRate
    delete fields.regionalTotal
    delete fields.serviceRate
    delete fields.serviceTotal
    delete fields.totalNet
    delete fields.lessorRate
    delete fields.lessorTotal
    delete fields.invoiceNo
  }
  if (regionId) {
    const regionName = report.get('regionals')[regionId].name
    filename = `${regionName} ${quarter}`
    delete fields.agencyRate
    delete fields.agencyTotal
    delete fields.serviceRate
    delete fields.serviceTotal
    delete fields.totalNet
    delete fields.lessorRate
    delete fields.lessorTotal
    delete fields.invoiceNo
  }
  if (lessorCode) {
    filename = `${lessorCode} ${quarter} Pacht`
    delete fields.total
    delete fields.agencyRate
    delete fields.agencyTotal
    delete fields.regionalRate
    delete fields.regionalTotal
    delete fields.serviceRate
    delete fields.serviceTotal
    delete fields.invoiceNo
  }

  const rows = report.get('rows').filter((row) => {
    if (distributorId) {
      return row.distributorId === distributorId
    }
    if (agencyId) {
      return row.agencyId === agencyId
    }
    if (regionId) {
      return row.regionId === regionId
    }
    if (lessorCode) {
      return row.lc === lessorCode
    }
    return true
  }).map((row) => {
    row.start = moment(row.start).format('DD.MM.YYYY')
    row.end = moment(row.end).format('DD.MM.YYYY')
    row.periodStart = moment(row.periodStart).format('DD.MM.YYYY')
    row.periodEnd = moment(row.periodEnd).format('DD.MM.YYYY')
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
  res.set('Content-Disposition', `attachment; filename=${filename}.xlsx`)
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
