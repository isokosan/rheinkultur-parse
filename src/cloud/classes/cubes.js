const { ORDER_CLASSES, getNewNo, getActiveCubeOrder, getFutureCubeOrder } = require('@/shared')
const redis = require('@/services/redis')
const { indexCube, unindexCube, indexCubeBookings } = require('@/cloud/search')
const { PDGA, errorFlagKeys, warningFlagKeys, editableFlagKeys } = require('@/cloud/cube-flags')

const Cube = Parse.Object.extend('Cube', {
  getStatus () {
    if (this.get('futureOrder') && ['Contract', 'Booking'].includes(this.get('futureOrder').className)) {
      return 6
    }
    if (this.get('order') && ['Contract', 'Booking'].includes(this.get('order').className)) {
      return 6
    }
    const order = this.get('order') || this.get('futureOrder')
    if (order) {
      if (order.className === 'FrameMount') {
        return 5
      }
      if (order.className === 'SpecialFormat') {
        return 4
      }
    }
    if (this.get('pair')) { return 9 }
    if (this.get('dAt')) { return 8 }
    const flags = this.get('flags') || []
    if (errorFlagKeys.some(key => flags.includes(key))) {
      return 7
    }
    if (warningFlagKeys.some(key => this.get(key))) {
      return 3
    }
    return 0
  }
})

function setFlag (flags = [], flag, flagged) {
  if (flagged) {
    return [...flags, flag]
  }
  return [...new Set(flags.filter(f => f !== flag))]
}

Parse.Cloud.beforeSave(Cube, async ({ object: cube, context: { before, updating, orderStatusCheck } }) => {
  if (!(/^[A-Za-z0-9ÄÖÜäöüß*_/()-]+$/.test(cube.id))) {
    throw new Error('CityCube ID sollte nicht die folgende Zeichen behalten: ".", "$", "%", "?", "+", " ", "Ãœ"')
  }

  // require state and ort (for placekey operations) - cannot update schema
  if (!cube.get('state')) { throw new Error(`Cube ${cube.id} missing state`) }
  if (!cube.get('ort')) { throw new Error(`Cube ${cube.id} missing ort`) }
  cube.set('pk', $pk(cube))

  // trim address
  for (const key of ['str', 'hsnr', 'plz', 'ort']) {
    cube.get(key) && cube.set(key, cube.get(key).trim())
  }

  // media
  if (cube.get('ht') && !cube.get('media')) {
    const ht = await cube.get('ht').fetch({ useMasterKey: true })
    cube.set('media', ht.get('media'))
  }

  // unique flags
  cube.get('flags')?.length ? cube.set('flags', [...new Set(cube.get('flags'))]) : cube.unset('flags')

  if (updating === true) { return }

  if (orderStatusCheck) {
    const order = await getActiveCubeOrder(cube.id)
    order ? cube.set('order', order) : cube.unset('order')
    const futureOrder = await getFutureCubeOrder(cube.id)
    futureOrder ? cube.set('futureOrder', futureOrder) : cube.unset('futureOrder')
  }

  if (cube.get('lc') === 'TLK') {
    cube.set('flags', setFlag(cube.get('flags'), 'bPLZ', Boolean(await redis.sismember('blacklisted-plzs', cube.get('plz')))))
    cube.set('flags', setFlag(cube.get('flags'), 'PDGA', Boolean(PDGA[cube.get('pk')])))
  }

  cube.get('order') ? cube.set('caok', cube.get('order').className + '$' + cube.get('order').objectId) : cube.unset('caok')
  cube.get('futureOrder') ? cube.set('ffok', cube.get('futureOrder').className + '$' + cube.get('futureOrder').objectId) : cube.unset('ffok')
  cube.set('s', cube.getStatus())
  await indexCube(cube, cube.isNew() ? {} : before)
  await indexCubeBookings(cube)
  cube.unset('s').unset('klsId')
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

Parse.Cloud.afterSave(Cube, async ({ object: cube, context: { audit, updating, checkBriefings } }) => {
  if (updating === true) { return }
  audit && $audit(cube, audit)
  // check cube pairs, if the save was not initiated by pair function
  if (!audit || !['cube-set-pair', 'cube-unset-pair'].includes(audit.fn)) {
    checkARPair(cube)
  }
  if (checkBriefings) {
    if (cube.get('order') || cube.get('futureOrder')) {
      Parse.Cloud.run('briefings-remove-booked-cube', { cubeId: cube.id }, { useMasterKey: true })
    }
  }
})

Parse.Cloud.beforeDelete(Cube, async ({ object: cube }) => {
  await unindexCube(cube)
})

Parse.Cloud.afterDelete(Cube, $deleteAudits)

// if query is coming from public api, hide soft deleted cubes
Parse.Cloud.beforeFind(Cube, async ({ query, user, master }) => {
  const isPublic = !user && !master
  isPublic && query.equalTo('dAt', null).equalTo('pair', null)
})

const PUBLIC_FIELDS = ['media', 'hti', 'str', 'hsnr', 'plz', 'ort', 'stateId', 's', 'p1', 'p2', 'vAt']
Parse.Cloud.afterFind(Cube, async ({ objects: cubes, query, user, master }) => {
  const isPublic = !user && !master
  // everything that is set here is necessary for indexing when the cube is saved
  for (const cube of cubes) {
    if (cube.get('lc') === 'TLK') {
      cube.set('klsId', cube.get('importData')?.klsId)
      cube.set('flags', setFlag(cube.get('flags'), 'bPLZ', Boolean(await redis.sismember('blacklisted-plzs', cube.get('plz')))))
      cube.set('flags', setFlag(cube.get('flags'), 'PDGA', Boolean(PDGA[cube.get('pk')])))
    }

    cube.set('s', cube.getStatus())
    if (cube.get('hti') && ['59', '82', '82 A', '82 B', '82 C', '83', '92'].includes(cube.get('hti'))) {
      cube.set('hti', `KVZ ${cube.get('hti')}`)
    }
    cube.get('flags')?.includes('htNM') && cube.set('hti', 'Nicht vermarktbar')

    if (isPublic) {
      for (const key of Object.keys(cube.attributes)) {
        if (!PUBLIC_FIELDS.includes(key)) {
          cube.unset(key)
        }
      }
      cube.get('s') >= 5 ? cube.set('s', 7) : cube.set('s', 0)
      continue
    }

    // if is partner request
    const isPartner = !master && user && user.get('accType') === 'partner' && user.get('company')
    if (isPartner) {
      cube.get('s') === 4 && cube.set('s', 0)
      cube.get('s') === 5 && cube.set('s', 6)
      // show as not available to partners if booked by other company
      const companyId = cube.get('order')?.company?.id || cube.get('futureOrder')?.company?.id
      if (cube.get('s') === 6 && companyId !== user.get('company').id) {
        cube.set('s', 7)
      }
      continue
    }

    if (query._include.includes('draftOrders')) {
      const contracts = await $query('Contract')
        .equalTo('cubeIds', cube.id)
        .greaterThanOrEqualTo('status', 0)
        .lessThanOrEqualTo('status', 2.1)
        .find({ useMasterKey: true })
        .then(contracts => contracts.map(contract => ({
          className: 'Contract',
          ...contract.toJSON(),
          earlyCanceledAt: contract.get('earlyCancellations')?.[cube.id]
        })))
      const bookings = await $query('Booking')
        .equalTo('cubeIds', cube.id)
        .greaterThanOrEqualTo('status', 0)
        .lessThanOrEqualTo('status', 2.1)
        .notEqualTo(`earlyCancellations.${cube.id}`, true)
        .find({ useMasterKey: true })
        .then(bookings => bookings.map(booking => ({
          className: 'Booking',
          ...booking.toJSON(),
          earlyCanceledAt: booking.get('earlyCancellations')?.[cube.id]
        })))
      cube.set('draftOrders', [...contracts, ...bookings].sort((a, b) => a.endsAt < b.endsAt ? 1 : -1))
    }

    if (query._include.includes('orders')) {
      // TOLIMIT: 100 limit for each order type
      const orders = await Promise.all(ORDER_CLASSES.map((className) => {
        return $query(className)
          .equalTo('cubeIds', cube.id)
          .find({ useMasterKey: true })
          .then(orders => orders.map(order => ({
            className,
            ...order.toJSON(),
            earlyCanceledAt: order.get('earlyCancellations')?.[cube.id]
          })))
      })).then(orders => orders.flat().sort((a, b) => a.endsAt < b.endsAt ? 1 : -1))
      cube.set('orders', orders)
      cube.set('draftOrders', cube.get('orders').filter(order => order.status >= 0 && order.status <= 2.1))
    }

    if (query._include.includes('scoutSubmissions')) {
      const scoutSubmissions = await $query('ScoutSubmission')
        .equalTo('cube', cube)
        .find({ useMasterKey: true })
        .then(scoutSubmissions => scoutSubmissions.map(b => b.toJSON()))
      cube.set('scoutSubmissions', scoutSubmissions)
    }

    if (query._include.includes('lastControlSubmission')) {
      const lastControlSubmission = await $query('ControlSubmission')
        .equalTo('cube', cube)
        .descending('createdAt')
        .first({ useMasterKey: true })
        .then(submission => submission?.toJSON())
      cube.set('lastControlSubmission', lastControlSubmission)
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
}, $internOrAdmin)

Parse.Cloud.define('cube-update-media', async ({ params: { id, media }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (cube.get('ht')) {
    throw new Error('Sie können nur Medien einstellen, wenn der Gehäusetyp unbekannt ist.')
  }
  const changes = $changes(cube, { media })
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
  cube.set({ media })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-update-ht', async ({ params: { id, housingTypeId }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (housingTypeId === 'htNM') {
    const changes = { htId: [cube.get('ht')?.id, 'htNM'] }
    const audit = { user, fn: 'cube-update', data: { changes } }
    cube.unset('ht')
    const flags = cube.get('flags') || []
    flags.push('htNM')
    cube.set({ flags })
    return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
  }
  const htNM = cube.get('flags')?.includes('htNM')
  const ht = housingTypeId ? await $getOrFail('HousingType', housingTypeId) : null
  const currentHtId = htNM ? 'htNM' : (cube.get('ht')?.id || null)
  if (currentHtId === (housingTypeId || null)) { throw new Error('Keine Änderung.') }
  const changes = { htId: [htNM ? 'htNM' : cube.get('ht')?.id, housingTypeId] }
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
  cube.set('flags', (cube.get('flags') || []).filter(flag => flag !== 'htNM'))
  housingTypeId
    ? cube.set({ ht, media: ht.get('media') })
    : cube.unset('ht')
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-update-address', async ({ params: { id, address: { str, hsnr, plz, ort }, stateId }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const state = await $getOrFail('State', stateId)
  const changes = $changes(cube, { str, hsnr, plz, ort })
  if (state?.id !== cube.get('state')?.id) {
    changes.stateId = [cube.get('state')?.id, stateId]
  }
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
  cube.set({
    str: str?.trim() || null,
    hsnr: hsnr?.trim() || null,
    plz: plz?.trim() || null,
    ort: ort?.trim() || null,
    state
  })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-update-geopoint', async ({ params: { id, gp }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const changes = $changes(cube, { gp })
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
  cube.set({ gp })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-update-flags', async ({ params: { id, flags: form }, user }) => {
  const cube = await $getOrFail(Cube, id)
  // TODO: Make sure paired flags are synced
  if (cube.get('pair')) {
    throw new Error('Please update the pair instead.')
  }
  let flags = cube.get('flags') || []
  const changes = {}
  for (const key of editableFlagKeys) {
    const wasFlagged = flags.includes(key) || undefined
    const isFlagged = form.includes(key) || undefined
    if (wasFlagged !== isFlagged) {
      changes[key] = [wasFlagged, isFlagged]
      isFlagged ? flags.push(key) : (flags = flags.filter(flag => flag !== key))
    }
  }
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
  cube.set({ flags })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-update-sides', async ({ params: { id, ...params }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const sides = {}
  for (const field of ['front', 'left', 'right', 'back']) {
    if ([null, 'y', 'n'].includes(params[field])) {
      sides[field] = params[field] || undefined
    }
  }
  const changes = $changes(cube, { sides })
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
  cube.set({ sides })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-update-features', async ({ params: { id, ...params }, user }) => {
  const cube = await $getOrFail(Cube, id)
  const features = {}
  for (const field of ['obstructionLevel', 'nearTrafficLights', 'angleToTraffic']) {
    features[field] = params[field]
  }
  const changes = $changes(cube.get('features') || {}, features, true)
  if (!$cleanDict(changes)) { throw new Error('Keine Änderungen.') }
  cube.set({ features })
  const audit = { user, fn: 'cube-update', data: { changes } }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-verify', async ({ params: { id }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (cube.get('vAt')) {
    throw new Error('CityCube ist bereits verifiziert')
  }
  if (cube.get('dAt')) {
    throw new Error('CityCube kann nicht verifiziert werden, weil er ausgeblendet ist. ')
  }
  if (!cube.get('ht') && !cube.get('flags')?.includes('htNM')) {
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

Parse.Cloud.define('cube-undo-verify-preview', async ({ params: { id }, user }) => {
  const cube = await $getOrFail(Cube, id, 'orders')
  if (!cube.get('vAt')) { throw new Error('CityCube ist nicht verifiziert.') }
  const orders = []
  for (const item of cube.get('orders')) {
    const order = await $getOrFail(item.className, item.objectId, ['production', 'company', 'cubeData'])
    const fixedContractPricing = item.className === 'Contract' && order.get('pricingModel') === 'fixed'
    // const fixedBookingPricing = item.className === 'Booking' && order.get('company').get('distributor')
    const hasProduction = Boolean(order.get('production'))
    const hasPrintPackage = hasProduction && Boolean(order.get('production').get('printPackages')?.[cube.id])
    const hasPrintFile = hasPrintPackage && Boolean(order.get('production').get('printFiles')?.[cube.id])
    orders.push({
      className: order.className,
      ...order.toJSON(),
      savedData: order.get('cubeData')?.[cube.id],
      fixedContractPricing,
      // fixedBookingPricing,
      hasProduction,
      hasPrintPackage,
      hasPrintFile
    })
  }
  return orders.length ? orders : true
}, $internOrAdmin)

Parse.Cloud.define('cube-undo-verify', async ({ params: { id, force }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (!cube.get('vAt')) { throw new Error('CityCube ist bereits nicht verifiziert.') }
  cube.set('vAt', null)
  const audit = { user, fn: 'cube-undo-verify' }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-hide', async ({ params: { id }, user }) => {
  const cube = await $getOrFail(Cube, id)
  if (cube.get('vAt') || cube.get('contract')) {
    throw new Error(`CityCube ${id} kann nicht ausgeblendet werden, weil er verifiziert oder in einem Vertrag ist.`)
  }
  cube.set({ dAt: new Date() })
  const audit = { user, fn: 'cube-hide' }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('cube-restore', async ({ params: { id }, user }) => {
  const cube = await $query(Cube)
    .equalTo('objectId', id)
    .first({ useMasterKey: true })
  cube.set('dAt', null)
  const audit = { user, fn: 'cube-restore' }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

// KNOWN BUGS: If an internal user changes around Front and Umfeld while a scout form is awaiting approval, the Front and Umfeld selections of the scout will be lost.
Parse.Cloud.define('cube-photo-select', async ({ params: { id, place, photoId }, user }) => {
  const cube = await $getOrFail(Cube, id, ['p1', 'p2'])
  const photo = await $getOrFail('CubePhoto', photoId)
  const photoNames = {
    p1: 'Front',
    p2: 'Umfeld'
  }
  const isIntern = ['admin', 'intern'].includes(user.get('accType'))
  const isOwnPhoto = user.id === photo.get('createdBy')?.id
  if (!isIntern) {
    if (!isOwnPhoto) { throw new Error('Unauthorized.') }
    if (place === 'p1' && cube.get('p1') && cube.get('p1')?.get('createdBy')?.id !== user.id) {
      throw new Error('Front foto schon von RMV festgelegt.')
    }
    if (place === 'p2' && cube.get('p2') && cube.get('p2')?.get('createdBy')?.id !== user.id) {
      throw new Error('Umfeld foto schon von RMV festgelegt.')
    }
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
      const otherPhotosQuery = isIntern
        ? Parse.Query.or($query('CubePhoto').equalTo('approved', true), $query('CubePhoto').equalTo('createdBy', user))
        : $query('CubePhoto').equalTo('createdBy', user)
      const otherCubePhotos = await otherPhotosQuery
        .equalTo('cubeId', cube.id)
        .notEqualTo('objectId', photoId)
        .find({ useMasterKey: true })
      if (otherCubePhotos.length === 1) {
        cube.set(otherPlace, otherCubePhotos[0])
        message = 'Front und Umfeld Fotos festgelegt.'
      }
    }
  }
  await $saveWithEncode(cube, null, { useMasterKey: true })
  return { message, p1: cube.get('p1'), p2: cube.get('p2') }
}, { requireUser: true })

Parse.Cloud.define('cube-photo-rethumb', async ({ params: { photoId } }) => {
  const photo = await $getOrFail('CubePhoto', photoId)
  return photo.save(null, { useMasterKey: true, context: { regenerateSize1000: true, regenerateThumb: true } })
}, $internOrAdmin)

Parse.Cloud.define('cube-photo-revert-original', async ({ params: { photoId } }) => {
  const photo = await $getOrFail('CubePhoto', photoId)
  const original = photo.get('original')
  await photo.get('file')?.destroy({ useMasterKey: true }).catch(consola.error)
  photo.unset('original').set('file', original)
  return photo.save(null, { useMasterKey: true, context: { regenerateSize1000: true, regenerateThumb: true } })
}, { requireUser: true })

Parse.Cloud.define('cube-photo-remove-kls-id', async ({ params: { photoId }, user }) => {
  const photo = await $getOrFail('CubePhoto', photoId)
  photo.set('createdBy', user).unset('klsId')
  await photo.save(null, { useMasterKey: true })
  const cubeId = photo.get('cubeId')
  const otherKlsPhotos = await $query('CubePhoto').equalTo('cubeId', cubeId).notEqualTo('klsId', null).count({ useMasterKey: true })
  if (otherKlsPhotos === 0) {
    const cube = await $getOrFail(Cube, cubeId)
    const legacyScoutResults = cube.get('legacyScoutResults') || {}
    if (legacyScoutResults && legacyScoutResults.multipleImages) {
      legacyScoutResults.multipleImagesFixed = true
      cube.set({ legacyScoutResults })
      await $saveWithEncode(cube, null, { useMasterKey: true })
      return { message: 'Alle KLS ID Warnungen sind gelöscht.' }
    }
  }
  return { message: 'KLS ID Warnung gelöscht.' }
}, $internOrAdmin)

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
}, $internOrAdmin)
