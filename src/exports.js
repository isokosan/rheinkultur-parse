const express = require('express')
const router = express.Router()

const excel = require('exceljs')
const handleErrorAsync = func => (req, res, next) => func(req, res, next).catch((error) => next(error))

router.get('/', handleErrorAsync(async (req, res) => {
  const workbook = new excel.stream.xlsx.WorkbookWriter({})
  const worksheet = workbook.addWorksheet('Sheetname')
  await worksheet.commit()
  const buffer = workbook.stream.read()
  const filename = 'Filename'
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set(`Content-Disposition', 'attachment; filename=${filename}.xlsx`)
  res.set('Content-Length', buffer.length)
  return res.send(buffer)
}))

module.exports = router
