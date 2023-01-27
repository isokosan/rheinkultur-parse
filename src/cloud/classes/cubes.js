const redis = require('@/services/redis')
const { getNewNo } = require('@/shared')
const { indexCube, unindexCube } = require('@/cloud/search')
const Cube = Parse.Object.extend('Cube', {
  getStatus () {
    if (this.get('dAt')) { return 9 }
    if (this.get('order')) { return 5 }
    if (this.get('bPLZ') || this.get('nMR') || this.get('MBfD') || this.get('PG') || this.get('Agwb')) {
      return 8
    }
    if (this.get('TTMR')) {
      return 7
    }

    if (this.get('vAt')) { return 3 }
    if (this.get('sAt')) { return 2 }
  }
})

Parse.Cloud.beforeSave(Cube, async ({ object: cube, context: { before, seeding } }) => {
  if (!(/^[A-Za-z0-9ÄÖÜäöüß*_/()-]+$/.test(cube.id))) {
    throw new Error('CityCube ID sollte nicht die folgende Zeichen behalten: ".", "$", "%", "?", "+", " ", "Ãœ"')
  }

  if (seeding === true) { return }
  // trim address
  for (const key of ['str', 'hsnr', 'plz', 'ort']) {
    cube.get(key) && cube.set(key, cube.get(key).trim())
  }

  // media
  if (cube.get('ht') && !cube.get('media')) {
    const ht = await cube.get('ht').fetch({ useMasterKey: true })
    cube.set('media', ht.get('media'))
  }

  // cube.get('lc') === 'TLK' && await redis.sismember('no-marketing-rights', cube.get('plz')) === 1
  //   ? cube.set('bPLZ', true)
  //   : cube.unset('bPLZ')

  cube.get('lc') === 'TLK' && $noMarketingRights[cube.get('plz')]
    ? cube.set('bPLZ', true)
    : cube.unset('bPLZ')

  cube.set('s', cube.getStatus())
  await indexCube(cube, cube.isNew() ? {} : before)

  // make sure computed values are unset and not persisted in DB
  cube.unset('s').unset('bPLZ').unset('klsId')
})

Parse.Cloud.afterSave(Cube, ({ object: cube, context: { audit } }) => {
  audit && $audit(cube, audit)
})

Parse.Cloud.beforeDelete(Cube, async ({ object: cube }) => {
  await unindexCube(cube)
})

Parse.Cloud.afterDelete(Cube, $deleteAudits)

Parse.Cloud.define('redis-test', async () => {
  let i = 0
  for (let plz = 10000; plz < 20000; plz++) {
    if (await redis.sismember('no-marketing-rights', `${plz}`) === 1) {
      i++
    }
    plz++
  }
  return i
})

Parse.Cloud.afterFind(Cube, async ({ objects: cubes, query }) => {
  for (const cube of cubes) {
    // TODO: Remove (open issue -> js sdk does not encodeURI so some chars in ID throw errors, whereas rest api works)
    cube.id = encodeURI(cube.id)

    if (cube.get('lc') === 'TLK') {
      cube.set('klsId', cube.get('importData')?.klsId)
      // await redis.sismember('no-marketing-rights', cube.get('plz')) === 1
      //   ? cube.set('bPLZ', true)
      //   : cube.unset('bPLZ')
      await $noMarketingRights[cube.get('plz')]
        ? cube.set('bPLZ', true)
        : cube.unset('bPLZ')
    }

    cube.set('s', cube.getStatus())

    if (query._include.includes('orders')) {
      const contracts = await $query('Contract')
        .equalTo('cubeIds', cube.id)
        .find({ useMasterKey: true })
        .then(contracts => contracts.map(contract => ({
          className: 'Contract',
          ...contract.toJSON(),
          earlyCanceledAt: contract.get('earlyCancellations')?.[cube.id],
          endsAt: contract.get('earlyCancellations')?.[cube.id] || contract.get('endsAt')
        })))
      const bookings = await $query('Booking')
        .equalTo('cubeIds', cube.id)
        .find({ useMasterKey: true })
        .then(bookings => bookings.map(booking => ({
          className: 'Booking',
          ...booking.toJSON(),
          earlyCanceledAt: booking.get('earlyCancellations')?.[cube.id],
          endsAt: booking.get('earlyCancellations')?.[cube.id] || booking.get('endsAt')
        })))
      cube.set('orders', [...contracts, ...bookings].sort((a, b) => a.endsAt < b.endsAt ? 1 : -1))
    }

    if (query._include.includes('scoutSubmissions')) {
      const scoutSubmissions = await $query('ScoutSubmission')
        .equalTo('cube', cube)
        .find({ useMasterKey: true })
        .then(scoutSubmissions => scoutSubmissions.map(b => b.toJSON()))
      cube.set('scoutSubmissions', scoutSubmissions)
    }
  }
  return cubes
})

const getNewUnknownCubeId = prefix => getNewNo(prefix, Cube, 'objectId', 4)

Parse.Cloud.define('cube-create', async ({
  params: {
    lc,
    unknownCubeId,
    cubeId,
    htId,
    klsId,
    str,
    hsnr,
    plz,
    ort,
    stateId,
    gp
  }, user
}) => {
  const objectId = unknownCubeId
    ? await getNewUnknownCubeId(lc + '-RMV')
    : lc + '-' + cubeId
  try {
    const { data: cube } = await Parse.Cloud.httpRequest({
      method: 'POST',
      url: `${process.env.PUBLIC_SERVER_URL}/classes/Cube`,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-Master-Key': process.env.MASTER_KEY
      },
      body: {
        objectId,
        lc: lc.trim(),
        cubeId: cubeId.trim(),
        ht: htId ? $pointer('HousingType', htId) : undefined,
        str: str?.trim(),
        hsnr: hsnr?.trim(),
        plz: plz?.trim(),
        ort: ort?.trim(),
        state: stateId ? $pointer('State', stateId) : undefined,
        gp,
        importData: klsId?.trim() ? { klsId: klsId?.trim() } : undefined
      }
    })
    $audit({ className: 'Cube', objectId }, { user, fn: 'cube-create' })
    return cube
  } catch (error) {
    if (error.data.code === 137) {
      throw new Error('CityCube mit der selben ID ' + objectId + '  existiert bereits.')
    }
    throw new Error(error.data.error)
  }
}, { requireUser: true })

Parse.Cloud.define('cube-update-media', async ({ params: { id, media }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (cube.get('ht')) {
    throw new Error('Sie können nur Medien einstellen, wenn der Gehäusetyp unbekannt ist.')
  }
  const changes = $changes(cube, { media })
  cube.set({ media })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-update-ht', async ({ params: { id, housingTypeId }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const ht = await $getOrFail('HousingType', housingTypeId)
  housingTypeId
    ? cube.set({ ht, media: ht.get('media') })
    : cube.unset('ht')
  const changes = { htId: [cube.get('ht')?.id, housingTypeId] }
  const audit = { user, fn: 'cube-update', data: { changes } }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-update-address', async ({ params: { id, address: { str, hsnr, plz, ort }, stateId }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const state = await $getOrFail('State', stateId)
  const changes = $changes(cube, { str, hsnr, plz, ort })
  if (state?.id !== cube.get('state')?.id) {
    changes.stateId = [cube.get('state')?.id, stateId]
  }
  cube.set({
    str: str?.trim() || null,
    hsnr: hsnr?.trim() || null,
    plz: plz?.trim() || null,
    ort: ort?.trim() || null,
    state
  })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-update-geopoint', async ({ params: { id, gp }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const changes = $changes(cube, { gp })
  cube.set({ gp })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-update-warnings', async ({ params: { id, ...params }, user, context: { seedAsId } }) => {
  const cube = await $getOrFail(Cube, id)
  const updates = {}
  for (const field of ['MBfD', 'nMR', 'TTMR', 'PG', 'Agwb']) {
    if (params[field] !== undefined) {
      updates[field] = params[field] || undefined
    }
  }
  const changes = $changes(cube, updates)
  consola.info(changes)
  if (!Object.keys(changes).length) {
    throw new Error('Keine Warnungen geändert.')
  }
  for (const field of Object.keys(updates)) {
    updates[field] ? cube.set({ [field]: updates[field] }) : cube.unset(field)
  }
  const audit = { user, fn: 'cube-update', data: { changes } }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

// TOTEST
// Parse.Cloud.define('cubes-bulk-update-warnings', async ({ params: { cubeIds, ...params }, user }) => {
//   const updates = {}
//   for (const field of ['MBfD', 'nMR', 'TTMR', 'PG', 'Agwb']) {
//     if (params[field] !== undefined) {
//       updates[field] = params[field] || undefined
//     }
//   }
//   let i = 0
//   for (const id of cubeIds) {
//     try {
//       const cube = await $getOrFail(Cube, id)
//       const changes = $changes(cube, updates)
//       for (const field of Object.keys(updates)) {
//         updates[field] ? cube.set({ [field]: updates[field] }) : cube.unset(field)
//       }
//       const audit = { user, fn: 'cube-update', data: { changes } }
//       await cube.save(null, { useMasterKey: true, context: { audit } })
//       i++
//     } catch (error) {
//       consola.error(error)
//     }
//   }
//   return i
// }, { requireUser: true })

Parse.Cloud.define('cube-verify', async ({ params: { id }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (cube.get('vAt')) {
    throw new Error('CityCube ist bereits verifiziert')
  }
  if (cube.get('dAt')) {
    throw new Error('CityCube kann nicht verifiziert werden, weil er ausgeblendet ist. ')
  }
  if (!cube.get('ht')) {
    throw new Error('Bitte Gehäusetyp auswählen.')
  }
  const { state, str, plz, ort } = cube.attributes
  if (!state || !str || !plz || !ort) {
    throw new Error('Bitte Anschrift vervollständigen.')
  }
  cube.set({ vAt: new Date() })
  const audit = { user, fn: 'cube-verify' }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, $internOrMaster)

Parse.Cloud.define('cube-hide', async ({ params: { id }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (cube.get('vAt') || cube.get('contract')) {
    throw new Error('CityCube kann nicht ausgeblendet werden, weil er verifiziert oder in einem Vertrag ist.')
  }
  cube.set({ dAt: new Date() })
  const audit = { user, fn: 'cube-hide' }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-restore', async ({ params: { id }, user }) => {
  const cube = await $query(Cube)
    .equalTo('objectId', id)
    .first({ useMasterKey: true })
  cube.set('dAt', null)
  const audit = { user, fn: 'cube-restore' }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-photo-select', async ({ params: { id, place, photoId }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const photo = await $getOrFail('CubePhoto', photoId)
  const photoNames = {
    p1: 'Front',
    p2: 'Umfeld'
  }
  let message
  if (cube.get(place)?.id === photoId) {
    cube.set(place, null)
    message = `Entfernt als ${photoNames[place]}-Foto.`
  } else {
    cube.get('p1')?.id === photoId && cube.set('p1', null)
    cube.get('p2')?.id === photoId && cube.set('p2', null)
    cube.set(place, photo)
    message = `Festgelegt als ${photoNames[place]}-Foto.`
    const otherPlace = place === 'p1' ? 'p2' : 'p1'
    if (!cube.get(otherPlace)) {
      const otherCubePhotos = await $query('CubePhoto').equalTo('cubeId', cube.id).notEqualTo('objectId', photoId).find({ useMasterKey: true })
      if (otherCubePhotos.length === 1) {
        cube.set(otherPlace, otherCubePhotos[0])
        message = 'Front und Umfeld Fotos festgelegt.'
      }
    }
  }
  await cube.save(null, { useMasterKey: true })
  return { message, p1: cube.get('p1'), p2: cube.get('p2') }
}, { requireUser: true })

Parse.Cloud.define('cubes-early-cancel', async ({ params: { itemClass, itemId, cancellations, generateCreditNote }, user }) => {
  const item = await $getOrFail(itemClass, itemId)
  const earlyCancellations = item.get('earlyCancellations') || {}
  for (const cubeId of Object.keys(cancellations)) {
    if (!item.get('cubeIds').includes(cubeId)) {
      throw new Error(`CityCube ${cubeId} ist nicht in Vertrag/Buchung.`)
    }
    if (earlyCancellations[cubeId]) {
      throw new Error(`CityCube ${cubeId} bereits storniert.`)
    }
    earlyCancellations[cubeId] = cancellations[cubeId]
  }

  // check if any cubes are left, if not, should cancel the item instead
  if (Object.keys(earlyCancellations).length === item.get('cubeIds').length) {
    throw new Error('Sie dürfen nicht alle CityCubes frühzeitlig stornieren. Sie können den Vertrag/Buchung vorzeitig beenden.')
  }

  item.set({ earlyCancellations })
  const audit = { user, fn: 'cubes-early-cancel', data: { cancellations } }
  // update item with cube statuses
  await item.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  const count = Object.keys(cancellations).length
  let message = `${count < 2 ? 'CityCube' : 'CityCubes'} frühzeitlig storniert.`
  if (itemClass === 'Contract') {
    // attempt to update planned invoices
    await Parse.Cloud.run('contract-update-planned-invoices', { id: itemId }, { useMasterKey: true })
    message += ' Rechnungen werden automatisch aktualisiert.'
    // attempt to generate a credit note
    if (generateCreditNote) {
      try {
        const creditNote = await Parse.Cloud.run('contract-generate-cancellation-credit-note', { id: itemId, cancellations }, { useMasterKey: true })
        if (creditNote) {
          message += ' Gutschrift erstellt.'
        }
      } catch (error) {
        message += ' Gutschrift konnte nicht erstellt werden: '
        message += error.message
      }
    }
  }
  return message
}, { requireUser: true })
