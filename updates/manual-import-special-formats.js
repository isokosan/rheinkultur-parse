const path = require('path')
const filename = 'Standortliste_Gesamt_Sonderformate.csv'
const filepath = path.join(__dirname, '..', '..', 'imports', filename)
const csv = require('csvtojson')
global.Parse = require('parse/node')
const { parseAsDigitString } = require('./../src/utils')

// wrap the above in an async function
const run = async () => {
  const today = await $today()
  await $query('Disassembly')
    .notEqualTo('specialFormat', null)
    .each(disassembly => disassembly.destroy({ useMasterKey: true }), { useMasterKey: true })
  await $query('SpecialFormat')
    .each(async (specialFormat) => {
      await specialFormat
        .set('cubeIds', [])
        .unset('disassembly')
        .set('status', 0)
        .save(null, { useMasterKey: true, context: { setCubeStatuses: true } })
      await specialFormat.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
  console.log('all deleted!')
  const specialFormatOrders = {}
  // parse xlsx into json
  const rows = await csv({
    trim: true,
    ignoreEmpty: true
    // headers: ["Year", "Month", "Name"]
  }).fromFile(filepath)
  for (const data of rows) {
    if (!data.KVZ_ID) { continue }
    const cubeId = 'TLK-' + data.KVZ_ID
    const campaignNo = data.Kampagne
    const startsAt = data.Start
    const endsAt = data.Ende
    const key = [campaignNo, startsAt, endsAt].join('-')
    if (!specialFormatOrders[key]) {
      const start = moment(startsAt)
      const end = moment(endsAt)
      const initialDuration = end.add(1, 'day').diff(start, 'months', true)
      if (initialDuration !== 12) {
        throw new Error(`${data.Start} ${data.Ende} => Start and end dates are not 1 year apart`)
      }
      specialFormatOrders[key] = {
        company: $pointer('Company', 'FNFCxMgEEr'),
        campaignNo,
        externalOrderNo: data.Auftragsnummer,
        startsAt,
        endsAt,
        initialDuration,
        cubeIds: [],
        sfCounts: {}
      }
    }
    specialFormatOrders[key].cubeIds.push(cubeId)
    specialFormatOrders[key].sfCounts[cubeId] = parseInt(data['Anzahl Sonderformate'])
  }
  // iterate over specialFormatOrders and create/update orders
  const items = Object.values(specialFormatOrders)
  // first sort by date and get numbers
  items.sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  const nos = {
    20: 1,
    21: 1,
    22: 1,
    23: 1,
    24: 1
  }
  for (const item of items) {
    const year = moment(item.startsAt).format('YY')
    item.no = 'SF' + year + '-' + parseAsDigitString(nos[year], 4)
    nos[year]++
  }

  items.sort((a, b) => b.startsAt.localeCompare(a.startsAt))

  for (const item of items) {
    console.log(item)
    // if (i >= 10) { break }
    item.cubeIds.sort()
    // get all cubes with order and future order
    const orderCubes = await $query('Cube')
      .containedIn('objectId', item.cubeIds)
      .notEqualTo('order', null)
      .limit(item.cubeIds.length)
      .find({ useMasterKey: true })
    const futureOrderCubes = await $query('Cube')
      .containedIn('objectId', item.cubeIds)
      .notEqualTo('futureOrder', null)
      .limit(item.cubeIds.length)
      .find({ useMasterKey: true })
    const earlyCancellations = {}
    if (orderCubes.length) {
      // check orders, if the start of the order is after the special format start date
      for (const cube of orderCubes) {
        if (earlyCancellations[cube.id]) {
          throw new Error('already early canceled!')
        }
        const orderStartsAt = cube.get('order').startsAt
        if (moment(orderStartsAt).isAfter(item.startsAt)) {
          earlyCancellations[cube.id] = moment(orderStartsAt).subtract(1, 'day').format('YYYY-MM-DD')
        } else {
          earlyCancellations[cube.id] = true
        }
      }
    }
    if (futureOrderCubes.length) {
      // check future orders, if the start of the future order is after the special format start date
      for (const cube of futureOrderCubes) {
        const futureOrderStartsAt = cube.get('futureOrder').startsAt
        if (earlyCancellations[cube.id]) {
          throw new Error('already early canceled!')
        }
        if (moment(futureOrderStartsAt).isAfter(item.startsAt)) {
          earlyCancellations[cube.id] = moment(futureOrderStartsAt).subtract(1, 'day').format('YYYY-MM-DD')
        } else {
          earlyCancellations[cube.id] = true
        }
      }
    }
    item.earlyCancellations = earlyCancellations
    const specialFormat = new Parse.Object('SpecialFormat')
    specialFormat.set(item)
    let status = 3 // active
    if (moment(today).isAfter(item.endsAt)) {
      status = 5 // expired
    }
    specialFormat.set({ status })
    specialFormat.set({ disassembly: { fromRMV: true } })
    await specialFormat.save(null, { useMasterKey: true, context: { setCubeStatuses: true } })
    consola.success(item.campaignNo, 'created')
  }
}

require('./run')(run)
