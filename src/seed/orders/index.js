const path = require('path')
const fs = require('fs').promises
const { round2 } = require('@/utils')
const { getCompanyByImportNo } = require('./../companies')

const seedCubeHtMedia = async () => {
  const updates = await fs.readFile(path.join(BASE_DIR, '/seed/data/prepared-order-cubes.json')).then(JSON.parse)
  const { fetchHousingTypes } = require('@/cloud/classes/housing-types')
  const housingTypes = await fetchHousingTypes()
  const updateIds = Object.keys(updates)
  let u = 0
  let s = 0
  for (const id of updateIds) {
    const cube = await $getOrFail('Cube', id)
    if (updates[id].htId && updates[id].htId !== cube.get('ht')?.id) {
      cube.set({
        ht: $pointer('HousingType', updates[id].htId),
        media: housingTypes[updates[id].htId].media
      })
      await cube.save(null, { useMasterKey: true })
      u++
      continue
    }
    if (updates[id].media && updates[id].media !== cube.get('media')) {
      cube.set({ media: updates[id].media })
      await cube.save(null, { useMasterKey: true })
      u++
      continue
    }
    s++
    consola.info(u, s, `${u + s}/${updateIds.length}`)
  }
  consola.success('seeded cubes media and ht')
}
Parse.Cloud.define('seed-cube-ht-media', async () => {
  seedCubeHtMedia()
  return 'ok'
})

const seedCubeComments = async () => {
  const updates = await fs.readFile(path.join(BASE_DIR, '/seed/data/prepared-order-cubes.json')).then(JSON.parse)
  const updateIds = Object.keys(updates)
  let u = 0
  let s = 0
  for (const id of updateIds) {
    if (!updates[id].comment) {
      s++
      continue
    }
    const text = `Standortkommentar: ${updates[id].comment}`
    if (await $query('Comment').equalTo('itemClass', 'Cube').equalTo('itemId', id).equalTo('text', text).count({ useMasterKey: true })) {
      s++
      continue
    }
    await Parse.Cloud.run(
      'comment-create',
      { itemClass: 'Cube', itemId: id, text },
      { useMasterKey: true }
    )
    u++
    consola.info(u, s, `${u + s}/${updateIds.length}`)
  }
  consola.success('seeded cube comments')
}
Parse.Cloud.define('seed-cube-comments', async () => {
  seedCubeComments()
  return 'ok'
})

const purgeOrders = async () => {
  const orderClasses = [
    'Contract',
    'Booking',
    'Production',
    'Invoice',
    'QuarterlyReport',
    'AgencyTotal',
    'LessorTotal'
  ]
  await Promise.all(orderClasses.map(className => (new Parse.Schema(className)).purge()))
  consola.info('cleaning order cubes')
  let i = 0
  while (true) {
    const { results: cubes, count } = await $query('Cube')
      .notEqualTo('order', null)
      .withCount()
      .find({ useMasterKey: true })
    if (!cubes.length) {
      break
    }
    consola.info(`cleaning ${cubes.length} cubes of ${count} remaining`)
    for (const cube of cubes) {
      cube.unset('order')
      await cube.save(null, { useMasterKey: true })
    }
    i += cubes.length
  }
  consola.success('cleaned all cubes')
  return Promise.resolve(i)
}

const seedOrders = async ({ purge, orderNo, orderNos, customerNo, setCubeStatuses, recalculateGradualInvoices }) => {
  purge && await purgeOrders()
  const skippedOrderNos = await $query('SkippedOrderImport').distinct('no', { useMasterKey: true })
  let skippedOrders = 0
  const { orders } = await fs.readFile(path.join(BASE_DIR, '/seed/data/processed-orders.json')).then(JSON.parse)
  const errors = []
  const today = await $today()

  const responsibleIds = {}
  for (const user of await $query(Parse.User).find({ useMasterKey: true })) {
    if (user.get('email') === 'marc@asriel.de') {
      continue
    }
    responsibleIds[user.get('email')] = user.id
  }

  async function seedOrder (order) {
    const { company, address, invoiceAddress } = await getCompanyByImportNo(order.customerNo)
    consola.info('seeding order', order.no, `${order.customerNo} (${company.get('name')})`, Object.keys(order.cubes).length)
    const cubeIds = Object.keys(order.cubes)
    if (skippedOrderNos.includes(order.no)) {
      skippedOrders++
      consola.error('skipping skipped order')
      return
    }
    if (!cubeIds.length) {
      throw new Error('no cubes')
    }
    const seedAsId = responsibleIds[order.responsibleEmail]
    const {
      startsAt,
      endsAt,
      initialDuration,
      extendedDuration,
      autoExtends,
      autoExtendsBy,
      motive,
      externalOrderNo,
      campaignNo,
      invoiceDescription,
      comments,
      demontageRMV
    } = order
    let no = order.no
    // distributor check
    let itemClass, itemId, production

    if (demontageRMV) {
      production = new (Parse.Object.extend('Production'))({ disassembly: true, disassemblyRMV: true })
    }

    let type = 'contract'
    if (company.get('distributor')) {
      type = 'booking'
      // mark asriel potsdam check
      if (parseInt(order.customerNo) === 107) {
        if (Object.values(order.cubes).every(cube => cube.ort !== 'Potsdam')) {
          type = 'contract'
        }
      }
    }

    no = type === 'booking' ? 'B' + no : 'V' + no

    if (type === 'booking') {
      const exists = await $query('Booking').equalTo('no', no).first({ useMasterKey: true })
      if (exists) {
        consola.info('skipping seeded booking', no)
        return
      }
      const pricingModel = company.get('distributor').pricingModel
      let booking = await Parse.Cloud.run('booking-create', {
        no,
        companyId: company.id,
        startsAt,
        endsAt,
        initialDuration,
        autoExtendsAt: autoExtends ? endsAt : undefined,
        autoExtendsBy,
        motive
      }, { useMasterKey: true, context: { seedAsId } })
      itemClass = 'Booking'
      itemId = booking.id

      let monthlyMedia
      if (!pricingModel) {
        monthlyMedia = {}
        for (const cubeId of cubeIds) {
          monthlyMedia[cubeId] = order.cubes[cubeId].kundenNetto
        }
      }
      let endPrices
      if (pricingModel === 'commission') {
        const { commission } = company.get('distributor')
        const rkNetRatio = (100 - commission) / 100
        endPrices = {}
        for (const cubeId of cubeIds) {
          const rkNetto = order.cubes[cubeId].kundenNetto
          endPrices[cubeId] = round2(rkNetto / rkNetRatio)
        }
      }

      booking = await Parse.Cloud.run('booking-update', {
        id: booking.id,
        cubeIds,
        companyId: company.id,
        motive,
        startsAt,
        initialDuration,
        endsAt,
        autoExtendsAt: endsAt,
        autoExtendsBy,
        endPrices,
        monthlyMedia
      }, { useMasterKey: true, context: { seedAsId } })

      extendedDuration && await booking.set({ extendedDuration }).save(null, { useMasterKey: true })

      try {
        await Parse.Cloud.run(
          'booking-activate',
          { id: booking.id },
          { useMasterKey: true, context: { seedAsId, setCubeStatuses } }
        )
      } catch (error) {
        if (!error.message.includes('ist bereits in')) {
          throw new Error(error)
        }
        errors.push(error.message)
      }

      await Parse.Cloud.run('comment-create', { itemClass, itemId, text: comments.join('\n') }, { useMasterKey: true })
      order.earlyCancellations && await Parse.Cloud.run('cubes-early-cancel', { itemClass, itemId, cancellations: order.earlyCancellations }, { useMasterKey: true })
      // if booking does not auto-extend and ends before today, end it
      if (!autoExtends && endsAt < today) {
        await Parse.Cloud.run('booking-end', { id: booking.id }, { useMasterKey: true, context: { seedAsId } })
      }
      production && production.set({
        booking,
        disassemblyStart: booking.get('autoExtends')
          ? undefined
          : moment(booking.get('endsAt')).add(1, 'days').format('YYYY-MM-DD')
      })
    } else {
      const exists = await $query('Contract').equalTo('no', no).first({ useMasterKey: true })
      if (exists) {
        consola.info('skipping seeded contract', no)
        return
      }
      let pricingModel = company.get('contractDefaults')?.pricingModel
      const differentInvoiceAddress = invoiceAddress?.id !== address.id

      let contract = await Parse.Cloud.run('contract-create', {
        no,
        companyId: company.id,
        addressId: address.id,
        invoiceAddressId: invoiceAddress?.id,
        differentInvoiceAddress,
        invoicingAt: order.invoicingAt,
        motive,
        externalOrderNo,
        campaignNo,
        startsAt,
        endsAt,
        initialDuration,
        billingCycle: order.billingCycle,
        pricingModel,
        paymentType: order.paymentType === 'Lastschrift' ? 1 : 0,
        dueDays: 14,
        agencyId: order.agencyName
          ? (await $query('Company').equalTo('name', order.agencyName).first({ useMasterKey: true })).id
          : undefined,
        commission: order.commissionRate,
        noticePeriod: 3,
        autoExtendsAt: order.autoExtends ? moment(order.endsAt).subtract(3, 'months').format('YYYY-MM-DD') : undefined,
        autoExtendsBy: order.autoExtendsBy
      }, { useMasterKey: true, context: { seedAsId } })
      itemClass = 'Contract'
      itemId = contract.id

      const cubes = await $query('Cube')
        .containedIn('objectId', cubeIds)
        .limit(cubeIds.length)
        .find({ useMasterKey: true })

      const monthlyMedia = {}
      if (pricingModel !== 'gradual') {
        let zero = true
        for (const cube of cubes) {
          monthlyMedia[cube.id] = order.cubes[cube.id].kundenNetto
          if (order.cubes[cube.id].kundenNetto) {
            zero = false
          }
        }
        if (zero) {
          pricingModel = 'zero'
        }
      }

      contract = await Parse.Cloud.run('contract-update', {
        id: contract.id,
        cubeIds,
        companyId: contract.get('company').id,
        addressId: contract.get('address').id,
        companyPersonId: contract.get('companyPerson')?.id,
        invoiceAddressId: contract.get('invoiceAddress')?.id,
        differentInvoiceAddress,
        invoicingAt: contract.get('invoicingAt'),
        paymentType: contract.get('paymentType'),
        dueDays: contract.get('dueDays'),
        motive: contract.get('motive'),
        externalOrderNo: contract.get('externalOrderNo'),
        campaignNo: contract.get('campaignNo'),
        agencyId: contract.get('agency')?.id,
        agencyPersonId: contract.get('agencyPerson')?.id,
        commission: contract.get('commission'),
        commissions: contract.get('commissions'),
        startsAt: contract.get('startsAt'),
        initialDuration: contract.get('initialDuration'),
        endsAt: contract.get('endsAt'),
        billingCycle: contract.get('billingCycle'),
        noticePeriod: contract.get('noticePeriod'),
        autoExtendsAt: contract.get('autoExtendsAt'),
        autoExtendsBy: contract.get('autoExtendsBy'),
        pricingModel,
        invoiceDescription,
        monthlyMedia
      }, { useMasterKey: true, context: { seedAsId } })

      extendedDuration && await contract.set({ extendedDuration }).save(null, { useMasterKey: true })
      try {
        await Parse.Cloud.run(
          'contract-finalize',
          { id: contract.id },
          { useMasterKey: true, context: { seedAsId, skipCubeValidations: true, setCubeStatuses, recalculateGradualInvoices } }
        )
      } catch (error) {
        errors.push(error.message)
      }
      await Parse.Cloud.run('comment-create', { itemClass, itemId, text: comments.join('\n') }, { useMasterKey: true })
      order.earlyCancellations && await Parse.Cloud.run('cubes-early-cancel', { itemClass, itemId, cancellations: order.earlyCancellations }, { useMasterKey: true })

      // if contract does not auto-extend and ends before today, end it
      if (!contract.get('autoExtendsAt') && contract.get('endsAt') < today) {
        await Parse.Cloud.run('contract-end', { id: contract.id }, { useMasterKey: true, context: { seedAsId } })
      }
      production && production.set({
        contract,
        disassemblyStart: contract.get('autoExtendsAt')
          ? undefined
          : moment(contract.get('endsAt')).add(1, 'days').format('YYYY-MM-DD')
      })
    }
    production && await production.save(null, { useMasterKey: true })
    return true
  }

  if (orderNo) {
    if (!orders[orderNo]) {
      throw new Error(`ORDER NO ${orderNo} NOT FOUND`)
    }
    await seedOrder(orders[orderNo])
    consola.success(`Order ${orderNo} seeded`)
    return
  }

  if (orderNos) {
    for (const no of orderNos) {
      if (!orders[no]) {
        throw new Error(`ORDER NO ${no} NOT FOUND`)
      }
      await seedOrder(orders[no])
      consola.success(`Order ${no} seeded`)
    }
    consola.success('All orderNos seeded')
    return
  }

  const ordersArr = customerNo
    ? Object.values(orders).filter(o => parseInt(o.customerNo) === parseInt(customerNo))
    : Object.values(orders)

  const count = ordersArr.length
  let i = 0
  for (const order of ordersArr) {
    try {
      await seedOrder(order)
    } catch (error) {
      consola.info(order)
      throw error
    }
    i++
    consola.info(`[${i}/${count}] ${order.no} done`)
  }
  consola.success('seeded orders', { skippedOrders, errors })
}
Parse.Cloud.define('seed-orders', ({ params: { purge, orderNo, customerNo, setCubeStatuses, recalculateGradualInvoices } }) => {
  seedOrders({ purge, orderNo, customerNo, setCubeStatuses, recalculateGradualInvoices }).catch(consola.error)
  return 'ok'
})

Parse.Cloud.define('seed-test-orders', async () => {
  // https://convert.town/column-to-comma-separated-list
  const orderNos = ['18-0314', '18-0472', '19-0026', '19-0080', '19-0099', '19-0151', '20-0403', '20-0404', '20-0601', '20-0719', '21-0067', '21-0131', '21-0189', '21-0559', '21-0632', '21-0649', '21-0702', '21-0731', '21-0766', '21-0856', '21-0888', '21-0893', '21-0897', '21-0957', '21-0988', '22-0072', '22-0086', '22-0088', '22-0217', '22-0375', '22-0571', '22-0720', '22-0839', '22-0842', '22-0901', '22-0996', '22-1006', '22-1008', '22-1050']
  seedOrders({ purge: true, orderNos, setCubeStatuses: true })
  return 'ok'
})
