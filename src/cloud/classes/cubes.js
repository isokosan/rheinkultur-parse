const { getNewNo } = require('@/shared')
const { indexCube, unindexCube } = require('@/cloud/search')
const Cube = Parse.Object.extend('Cube', {
  getStatus () {
    // available, booked, not available, not found
    if (this.get('order')) { return 5 }
    if (this.get('pair')) { return 9 }
    if (this.get('dAt')) { return 8 }
    if (this.get('bPLZ') || this.get('nMR') || this.get('MBfD') || this.get('PG')) {
      return 7
    }
    // When doing so should change the query of availability, or mark this as 4 instead of 6
    // if (this.get('TTMR') || this.get('PDGA') || this.get('Agwb')) {
    //   return 4
    // }
    return 0
  }
})

Parse.Cloud.beforeSave(Cube, async ({ object: cube, context: { before, updating } }) => {
  if (!(/^[A-Za-z0-9ÄÖÜäöüß*_/()-]+$/.test(cube.id))) {
    throw new Error('CityCube ID sollte nicht die folgende Zeichen behalten: ".", "$", "%", "?", "+", " ", "Ãœ"')
  }

  // require state and ort (for placekey operations) - cannot update schema
  if (!cube.get('state')) { throw new Error(`Cube ${cube.id} missing state`) }
  if (!cube.get('ort')) { throw new Error(`Cube ${cube.id} missing ort`) }

  // trim address
  for (const key of ['str', 'hsnr', 'plz', 'ort']) {
    cube.get(key) && cube.set(key, cube.get(key).trim())
  }

  // media
  if (cube.get('ht') && !cube.get('media')) {
    const ht = await cube.get('ht').fetch({ useMasterKey: true })
    cube.set('media', ht.get('media'))
  }

  if (cube.get('lc') === 'TLK') {
    $bPLZ[cube.get('plz')] ? cube.set('bPLZ', true) : cube.unset('bPLZ')
    const placeKey = [cube.get('state')?.id, cube.get('ort')].join(':')
    $PDGA[placeKey] ? cube.set('PDGA', true) : cube.unset('PDGA')
  }

  if (updating === true) { return }

  cube.set('s', cube.getStatus())
  await indexCube(cube, cube.isNew() ? {} : before)

  // make sure computed values are unset and not persisted in DB
  cube.unset('s').unset('bPLZ').unset('PDGA').unset('klsId')
})

function getARPair (cubeId) {
  // regex to test a single A character
  if (/^(?!.*A.*A.*$).*A.*$/.test(cubeId)) {
    return $query(Cube).equalTo('objectId', cubeId.replace('A', 'R')).first({ useMasterKey: true })
  }
  // regex to test a single R character
  if (/^(?!.*R.*R.*$).*R.*$/.test(cubeId)) {
    return $query(Cube).equalTo('objectId', cubeId.replace('R', 'A')).first({ useMasterKey: true })
  }
  return null
}

async function checkARPair (cube) {
  if (cube.get('lc') !== 'TLK') { return }
  const pair = await getARPair(cube.id)
  if (!pair) { return }
  function setPair (a, b) {
    if (a.get('pair')?.id === b.id) { return }
    const audit = { fn: 'cube-set-pair', data: { pairId: b.id } }
    return a.set('pair', b).save(null, { useMasterKey: true, context: { audit } })
  }
  function unsetPair (a) {
    if (!a.get('pair')) { return }
    const audit = { fn: 'cube-unset-pair', data: { pairId: a.get('pair').id } }
    return a.unset('pair').save(null, { useMasterKey: true, context: { audit } })
  }
  if (cube.get('order')) {
    await unsetPair(cube)
    pair.get('order') ? await unsetPair(pair) : await setPair(pair, cube)
    return
  }
  if (pair.get('order')) {
    await unsetPair(pair)
    cube.get('order') ? await unsetPair(cube) : await setPair(cube, pair)
    return
  }
  // if both are not booked, hide the R pair
  if (cube.id.includes('A')) {
    await unsetPair(cube)
    await setPair(pair, cube)
    return
  }
  await unsetPair(pair)
  await setPair(cube, pair)
}

Parse.Cloud.afterSave(Cube, ({ object: cube, context: { audit, updating } }) => {
  audit && $audit(cube, audit)
  // check cube pairs, if the save was not initiated by pair function
  if (updating || !audit || !['cube-set-pair', 'cube-unset-pair'].includes(audit.fn)) {
    checkARPair(cube)
  }
})

Parse.Cloud.beforeDelete(Cube, async ({ object: cube }) => {
  await unindexCube(cube)
})

Parse.Cloud.afterDelete(Cube, $deleteAudits)

// if query is coming from public api, hide soft deleted cubes
// TODO: Also hide for external users like distributors that do not scout
Parse.Cloud.beforeFind(Cube, async ({ query, user, master }) => {
  const isPublic = !user && !master
  isPublic && query.equalTo('dAt', null).equalTo('pair', null)
})

const PUBLIC_FIELDS = ['media', 'hti', 'str', 'hsnr', 'plz', 'ort', 'stateId', 's', 'p1', 'p2']
Parse.Cloud.afterFind(Cube, async ({ objects: cubes, query, user, master }) => {
  const isPublic = !user && !master
  for (const cube of cubes) {
    if (cube.get('lc') === 'TLK') {
      cube.set('klsId', cube.get('importData')?.klsId)
      $bPLZ[cube.get('plz')] ? cube.set('bPLZ', true) : cube.unset('bPLZ')
      const placeKey = [cube.get('state')?.id, cube.get('ort')].join(':')
      $PDGA[placeKey] ? cube.set('PDGA', true) : cube.unset('PDGA')
    }

    cube.set('s', cube.getStatus())
    if (cube.get('hti') && ['59', '82', '82 A', '82 B', '82 C', '83', '92'].includes(cube.get('hti'))) {
      cube.set('hti', `KVZ ${cube.get('hti')}`)
    }

    if (isPublic) {
      for (const key of Object.keys(cube.attributes)) {
        if (!PUBLIC_FIELDS.includes(key)) {
          cube.unset(key)
        }
      }
      cube.get('s') === 5 ? cube.set('s', 7) : cube.set('s', 0)
      continue
    }

    if (query._include.includes('orders')) {
      const contracts = await $query('Contract')
        .equalTo('cubeIds', cube.id)
        .notEqualTo(`earlyCancellations.${cube.id}`, true)
        .find({ useMasterKey: true })
        .then(contracts => contracts.map(contract => ({
          className: 'Contract',
          ...contract.toJSON(),
          earlyCanceledAt: contract.get('earlyCancellations')?.[cube.id],
          endsAt: contract.get('earlyCancellations')?.[cube.id] || contract.get('endsAt')
        })))
      const bookings = await $query('Booking')
        .equalTo('cubeIds', cube.id)
        .notEqualTo(`earlyCancellations.${cube.id}`, true)
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

    if (query._include.includes('otherPair')) {
      cube.set('otherPair', await getARPair(cube.id))
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
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-update-ht', async ({ params: { id, housingTypeId }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const ht = await $getOrFail('HousingType', housingTypeId)
  const changes = { htId: [cube.get('ht')?.id, housingTypeId] }
  housingTypeId
    ? cube.set({ ht, media: ht.get('media') })
    : cube.unset('ht')
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
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
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-update-geopoint', async ({ params: { id, gp }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const changes = $changes(cube, { gp })
  cube.set({ gp })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
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
  if (!Object.keys(changes).length) {
    throw new Error('Keine Warnungen geändert.')
  }
  for (const field of Object.keys(updates)) {
    updates[field] ? cube.set({ [field]: updates[field] }) : cube.unset(field)
  }
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

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
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-undo-verify', async ({ params: { id }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (!cube.get('vAt')) { throw new Error('CityCube ist nicht verifiziert.') }
  // do not allow unverifying if the cube was in a past production with assembly, or contract etc (temporary)
  const contracts = await $query('Contract').equalTo('cubeIds', cube.id).greaterThanOrEqualTo('status', 3).include('production').find({ useMasterKey: true })
  const fixedPricingContracts = contracts.filter(c => c.get('pricingModel') === 'fixed').map(c => c.get('no'))
  if (fixedPricingContracts.length) {
    throw new Error('CityCubes that are in finalized contracts with fixed pricing cannot be unverified. Please contact an administrator.')
  }
  const bookings = await $query('Booking').equalTo('cubeIds', cube.id).greaterThanOrEqualTo('status', 3).include('production').find({ useMasterKey: true })
  const orderNosWithProduction = [...contracts, ...bookings].filter(bc => bc.get('production')).map(bc => bc.get('no'))
  if (orderNosWithProduction.length) {
    throw new Error('CityCubes that are in finalized contracts/bookings which have production cannot be unverified. Please contact an administrator.')
  }
  cube.set('vAt', null)
  const audit = { user, fn: 'cube-undo-verify' }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-hide', async ({ params: { id }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (cube.get('vAt') || cube.get('contract')) {
    throw new Error('CityCube kann nicht ausgeblendet werden, weil er verifiziert oder in einem Vertrag ist.')
  }
  cube.set({ dAt: new Date() })
  const audit = { user, fn: 'cube-hide' }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, { requireUser: true })

Parse.Cloud.define('cube-restore', async ({ params: { id }, user }) => {
  const cube = await $query(Cube)
    .equalTo('objectId', id)
    .first({ useMasterKey: true })
  cube.set('dAt', null)
  const audit = { user, fn: 'cube-restore' }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
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
  await $saveWithEncode(cube, null, { useMasterKey: true })
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
