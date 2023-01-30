const path = require('path')
const { readFileSync, readdirSync } = require('fs')
const { promisify } = require('node:util')
const request = promisify(require('request'))

const HousingType = Parse.Object.extend('HousingType')

const getFileObjectByName = function (name) {
  return $query('FileObject').equalTo('name', encodeURIComponent(name)).first({ useMasterKey: true })
}

/**
 * For each kvzGehauseTyp we have [std, alu, foil] * [front, side]
 * Each gehausetyp has the same stdFront and stdSide
 * But each gehausetyp has their own aluFront, aluSide, foilFront and foilSide
 */
const getOrUploadStandardTemplates = async function () {
  const items = [
    {
      filename: 'Standard Format_Front_515x830.pdf',
      template: 'stdFrontFile',
      kvz: true,
      mfg: true
    },
    {
      filename: 'Standard Format_Seite KVZ_230x830.pdf',
      template: 'stdSideFile',
      kvz: true
    },
    {
      filename: 'Standard Format_Seite MFG_450x830.pdf',
      template: 'stdSideFile',
      mfg: true
    }
  ]
  const templates = { MFG: {}, KVZ: {} }
  for (const { filename, template, mfg, kvz } of items) {
    let file = await getFileObjectByName(filename)
    if (!file) {
      file = new Parse.File(
        filename,
        { base64: readFileSync(path.join(__dirname, 'templates', filename), { encoding: 'base64' }) },
        'application/pdf',
        { name: filename },
        { assetType: 'print-template' }
      )
      await file.save({ useMasterKey: true })
      file = await getFileObjectByName(filename)
    }
    if (kvz) {
      templates.KVZ[template] = $pointer('FileObject', file.id)
    }
    if (mfg) {
      templates.MFG[template] = $pointer('FileObject', file.id)
    }
  }
  return templates
}

const getOrUploadHtTemplates = async function (housingTypeCode, folder = 'templates') {
  const templates = {}
  const aluPath = path.join(__dirname, folder, housingTypeCode, 'Alu')
  const foilPath = path.join(__dirname, folder, housingTypeCode, 'Folie')
  try {
    const aluFiles = readdirSync(aluPath)
    templates.aluFrontFile = {
      filename: aluFiles.find(filename => filename.includes('Front')),
      directory: aluPath
    }
    templates.aluSideFile = {
      filename: aluFiles.find(filename => filename.includes('Seite')),
      directory: aluPath
    }
  } catch (error) {
    consola.error(error)
  }
  try {
    const foilFiles = readdirSync(foilPath)
    templates.foilFrontFile = {
      filename: foilFiles.find(filename => filename.includes('Front')),
      directory: foilPath
    }
    templates.foilSideFile = {
      filename: foilFiles.find(filename => filename.includes('Seite')),
      directory: foilPath
    }
  } catch (error) {
    consola.error(error)
  }
  for (const template of Object.keys(templates)) {
    const { filename, directory } = templates[template]
    if (!filename) {
      consola.error(`${housingTypeCode} missing ${template}`)
      delete templates[template]
      continue
    }
    let file = await getFileObjectByName(filename)
    if (!file) {
      consola.info('UPLOADING', filename)
      file = new Parse.File(
        encodeURIComponent(filename.replace(/Ü/g, 'UE').replace(/:/g, '-').replace(/ü/g, 'ue')),
        { base64: readFileSync(path.join(directory, filename), { encoding: 'base64' }) },
        'application/pdf',
        { name: filename },
        { assetType: 'print-template' }
      )
      await file.save({ useMasterKey: true })
      file = await getFileObjectByName(filename)
    }
    templates[template] = $pointer('FileObject', file.id)
  }
  return templates
}

const seed = async () => {
  const housingTypes = [
    {
      media: 'KVZ',
      code: 'KVZ 59',
      objectId: '08x01L2Uzm'
    },
    {
      media: 'KVZ',
      code: 'KVZ 82',
      objectId: 'tDPxwmd4uZ'
    },
    {
      media: 'MFG',
      code: 'MFG 12 SiCa',
      objectId: 'kXUF3cgoBN'
    },
    {
      media: 'KVZ',
      code: 'KVZ 83',
      objectId: 'sZmj80Yh87'
    },
    {
      media: 'MFG',
      code: 'MFG 1400',
      objectId: 'X37ikGHXEZ'
    },
    {
      media: 'MFG',
      code: 'MFG 15 Si R',
      objectId: 'XZMg0LAGkN'
    },
    {
      media: 'MFG',
      code: 'MFG 1300 L',
      objectId: 'Kq9AVwMhCN'
    },
    {
      media: 'MFG',
      code: 'MFG 1300 R',
      objectId: 'uTraE5gcOb'
    },
    {
      media: 'KVZ',
      code: 'KVZ 82 BK L',
      objectId: 'igtAciagLz'
    },
    {
      media: 'KVZ',
      code: 'KVZ 82 BK R',
      objectId: 'MHBgsYuzrO'
    },
    {
      media: 'MFG',
      code: 'MFG 15 ÜLP RayCab L',
      objectId: 'GRf0tIjhA9'
    },
    {
      media: 'MFG',
      code: 'MFG 15 ÜLP RayCab R',
      objectId: 'xtULqiy7mG'
    },
    {
      media: 'MFG',
      code: 'MFG 18 Alma',
      objectId: 'f79cSVJdSB'
    },
    {
      media: 'MFG',
      code: 'MFG 18 RayCab',
      objectId: 'QUYAGHFNkB'
    },
    {
      media: 'MFG',
      code: 'MFG 18 Ri',
      objectId: 'ivHZtYqSvP'
    },
    {
      media: 'MFG',
      code: 'MFG 18 Ri L',
      objectId: 'sAFhXL3dFR'
    },
    {
      media: 'MFG',
      code: 'MFG 15 Si L',
      objectId: 'BdQwQG0AAZ'
    },
    {
      media: 'MFG',
      code: 'MFG 18',
      objectId: 'UT6K5SzJHF'
    },
    {
      media: 'MFG',
      code: 'MFG 18 Ri R',
      objectId: 'YO5LbIgLdd'
    },
    {
      media: 'MFG',
      code: 'MFG 18 Schroff',
      objectId: '7t4KCBU9kb'
    },
    {
      media: 'MFG',
      code: 'MFG 18 Schroff V2',
      objectId: 'BeLjdf9IyE'
    },
    {
      media: 'MFG',
      code: 'MFG 18 Si',
      objectId: 'zrIka8OxBm'
    },
    {
      media: 'MFG',
      code: 'MFG 1970 L',
      objectId: 'MUqPBYEKBB'
    },
    {
      media: 'MFG',
      code: 'MFG 1970 R',
      objectId: 'NqH2av2NI3'
    },
    {
      media: 'MFG',
      code: 'MFG 2000',
      objectId: 'SR76KQyEEH'
    },
    {
      media: 'MFG',
      code: 'MFG 2010 15Ü L',
      objectId: 'SLhwp3boA3'
    },
    {
      media: 'MFG',
      code: 'MFG 2010 15Ü R',
      objectId: 'AAD2xSUnY1'
    },
    {
      media: 'MFG',
      code: 'MFG Huawai 1100',
      objectId: 'TsHWBJDe6u'
    },
    {
      media: 'MFG',
      code: 'MFG Huawai 1800',
      objectId: 'HKHnowss4a'
    },
    {
      media: 'MFG',
      code: 'MFG K Ü 18 LA',
      objectId: 'EFzf5bQA43'
    },
    {
      media: 'MFG',
      code: 'MFG K Ü 18 RA',
      objectId: 'E4090DMcEv'
    },
    {
      media: 'MFG',
      code: 'MFG Knürr 18 L',
      objectId: '7sH6fewHpN'
    },
    {
      media: 'MFG',
      code: 'MFG Knürr 18 R',
      objectId: 'cVkEYe7MtS'
    },
    {
      media: 'MFG',
      code: 'MFG Knürr 2000',
      objectId: 'i4ot63whin'
    },
    {
      media: 'MFG',
      code: 'MFG Nokia 1000',
      objectId: 'Zlo2vy6zaD'
    },
    {
      media: 'MFG',
      code: 'MFG Nokia 1200',
      objectId: 'RgCnV6Ynku'
    },
    {
      media: 'MFG',
      code: 'MFG Nokia 1850',
      objectId: 'kmangNBEzP'
    },
    {
      media: 'MFG',
      code: 'MFG X 12',
      objectId: 'u7y83HwFOm'
    },
    {
      media: 'MFG',
      code: 'MFG X 18',
      objectId: 'pDW2CFmWbL'
    },
    {
      media: 'MFG',
      code: 'MFG Ü 12',
      objectId: 'xAZlagAXWF'
    },
    {
      media: 'MFG',
      code: 'MFG Ü 15 L',
      objectId: 'UkoHIZFLgI'
    },
    {
      media: 'MFG',
      code: 'MFG Ü 15 R',
      objectId: 'OISZoequI0'
    },
    {
      media: 'MFG',
      code: 'MFG Ü 18',
      objectId: 'F9uG6AAidq'
    },
    {
      media: 'MFG',
      code: 'MFG Ü 18 V2 L',
      objectId: '6Z6FiXY0JB'
    },
    {
      media: 'MFG',
      code: 'MFG Ü 18 V2 R',
      objectId: '8vOQrvsNzf'
    },
    {
      media: 'MFG',
      code: 'MFG Ü 18_3er',
      objectId: 'xMjmrEk2Cz'
    }
  ]

  const requests = housingTypes.map(body => ({
    method: 'POST',
    path: '/parse/classes/HousingType/',
    body
  }))
  await request({
    url: `${process.env.PUBLIC_SERVER_URL}/batch`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-MASTER-Key': process.env.MASTER_KEY
    },
    json: true,
    body: { requests }
  })
  const standardTemplates = await getOrUploadStandardTemplates()
  const hts = await $query(HousingType).find({ useMasterKey: true })
  for (const ht of hts) {
    for (const key of Object.keys(standardTemplates[ht.get('media')])) {
      ht.set(key, standardTemplates[ht.get('media')][key])
    }
    const htTemplates = await getOrUploadHtTemplates(ht.get('code'))
    for (const key of Object.keys(htTemplates)) {
      ht.set(key, htTemplates[key])
    }
    await ht.save(null, { useMasterKey: true })
  }
}

const seedSG = async () => {
  let hts = await $query(HousingType).startsWith('code', 'SG_').find({ useMasterKey: true })
  if (!hts.length) {
    const SG_HOUSING_TYPES = [
      { code: 'SG_1', media: 'KVZ' },
      { code: 'SG_2', media: 'KVZ' },
      { code: 'SG_3', media: 'MFG' },
      { code: 'SG_4', media: 'KVZ' },
      { code: 'SG_5', media: 'KVZ' },
      { code: 'SG_6', media: 'KVZ' },
      { code: 'SG_7', media: 'MFG' },
      { code: 'SG_8', media: 'KVZ' },
      { code: 'SG_9', media: 'MFG' },
      { code: 'SG_10', media: 'KVZ' },
      { code: 'SG_11', media: 'KVZ' },
      { code: 'SG_12', media: 'KVZ' },
      { code: 'SG_13', media: 'KVZ' },
      { code: 'SG_14', media: 'MFG' },
      { code: 'SG_15', media: 'KVZ' },
      { code: 'SG_16', media: 'KVZ' },
      { code: 'SG_17', media: 'KVZ' },
      { code: 'SG_18', media: 'MFG' }
    ]
    for (const { code, media } of SG_HOUSING_TYPES) {
      const ht = new HousingType({ code, media })
      await ht.save(null, { useMasterKey: true }).catch(consola.error)
    }
    hts = await $query(HousingType).startsWith('code', 'SG_').find({ useMasterKey: true })
  }

  const standardTemplates = await getOrUploadStandardTemplates()
  for (const ht of hts) {
    for (const key of Object.keys(standardTemplates[ht.get('media')])) {
      ht.set(key, standardTemplates[ht.get('media')][key])
    }
    try {
      const htTemplates = await getOrUploadHtTemplates(ht.get('code'), 'SG')
      for (const key of Object.keys(htTemplates)) {
        ht.set(key, htTemplates[key])
      }
      await ht.save(null, { useMasterKey: true })
    } catch (error) {
      consola.error(error)
    }
  }
  consola.success('SG Housing Types seeded')
}

module.exports = {
  seed,
  seedSG
}
