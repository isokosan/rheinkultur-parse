const { frameMounts: { UNSET_NULL_FIELDS, normalizeFields } } = require('@/schema/normalizers')
const {
  getNewNo,
  validateOrderFinalize,
  setOrderCubeStatuses,
  getLastRemovedCubeIds,
  earlyCancelSpecialFormats
} = require('@/shared')

const FrameMount = Parse.Object.extend('FrameMount')

Parse.Cloud.beforeSave(FrameMount, async ({ object: frameMount }) => {
  frameMount.isNew() && !frameMount.get('no') && frameMount.set({ no: await getNewNo('MR' + moment(await $today()).format('YY') + '-', FrameMount, 'no') })
  UNSET_NULL_FIELDS.forEach(field => !frameMount.get(field) && frameMount.unset(field))

  frameMount.set('totalDuration', (frameMount.get('initialDuration') || 0) + (frameMount.get('extendedDuration') || 0))
  const canceled = Boolean(frameMount.get('canceledAt') || frameMount.get('voidedAt'))
  !canceled && frameMount.set('autoExtendsAt', frameMount.get('autoExtendsBy') ? moment(frameMount.get('endsAt')).subtract(frameMount.get('noticePeriod') || 0, 'months').format('YYYY-MM-DD') : null)

  // cubes
  const cubeIds = frameMount.get('cubeIds') || []
  if (cubeIds.length > CUBE_LIMIT) {
    throw new Error(`Es können maximal ${CUBE_LIMIT} CityCubes pro Auftrag hinzugefügt werden.`)
  }
  cubeIds.sort()
  frameMount.set('cubeIds', cubeIds).set('cubeCount', cubeIds.length)
})

Parse.Cloud.afterSave(FrameMount, async ({ object: frameMount, context: { audit, setCubeStatuses } }) => {
  setCubeStatuses && await setOrderCubeStatuses(frameMount)
  audit && $audit(frameMount, audit)
})

Parse.Cloud.beforeFind(FrameMount, ({ query }) => {
  query._include.includes('all') && query.include([
    'company',
    'docs',
    'tags',
    'lastRemovedCubeIds'
  ])
})

Parse.Cloud.afterFind(FrameMount, async ({ objects: frameMounts, query }) => {
  for (const frameMount of frameMounts) {
    // get computed property willExtend
    const willExtend = frameMount.get('autoExtendsBy') && !frameMount.get('canceledAt') && !frameMount.get('voidedAt')
    frameMount.set('willExtend', willExtend)

    if (query._include.includes('lastRemovedCubeIds') && frameMount.get('status') >= 0 && frameMount.get('status') <= 2.1) {
      frameMount.set('lastRemovedCubeIds', await getLastRemovedCubeIds('FrameMount', frameMount.id))
    }
  }
  return frameMounts
})

Parse.Cloud.beforeDelete(FrameMount, async ({ object: frameMount }) => {
  if (frameMount.get('status') !== 0 && frameMount.get('status') !== 2) {
    throw new Error('Nur Aufträge im Entwurfsstatus können gelöscht werden!')
  }
})

Parse.Cloud.afterDelete(FrameMount, async ({ object: frameMount }) => {
  $deleteAudits({ object: frameMount })
})

Parse.Cloud.define('frame-mount-create', async ({ params, user, master }) => {
  const {
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    disassemblyFromRMV
  } = normalizeFields(params)

  const company = await $getOrFail('Company', companyId)
  const frameMount = new FrameMount({
    status: 2,
    company,
    companyPerson: companyPersonId ? await $getOrFail('Person', companyPersonId) : undefined,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    responsibles: user ? [$pointer(Parse.User, user.id)] : undefined,
    tags: company.get('tags'),
    disassembly: disassemblyFromRMV
      ? { fromRMV: true }
      : null
  })
  const audit = { user, fn: 'frame-mount-create' }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-update-cubes', async ({ params: { id: frameMountId, ...params }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId, 'company')
  if (frameMount.get('status') >= 3) {
    throw new Error('CityCubes von finalisierte Aufträge können nicht mehr geändert werden.')
  }

  const { cubeIds } = normalizeFields(params)
  const cubeChanges = $cubeChanges(frameMount, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  frameMount.set({ cubeIds })

  const audit = { user, fn: 'frame-mount-update', data: { cubeChanges } }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-update', async ({ params: { id: frameMountId, ...params }, user }) => {
  const {
    cubeIds,
    companyId,
    companyPersonId,
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    disassemblyFromRMV
  } = normalizeFields(params)

  const frameMount = await $getOrFail(FrameMount, frameMountId, ['all'])
  if (frameMount.get('status') >= 3) {
    throw new Error('Finalisierte Aufträge können nicht mehr geändert werden.')
  }

  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(frameMount, cubeIds)
  cubeChanges && frameMount.set({ cubeIds })

  const changes = $changes(frameMount, {
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy
  })
  frameMount.set({
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy
  })

  const disassembly = frameMount.get('disassembly') || {}
  // add disassemblyFromRMV
  if (disassemblyFromRMV !== Boolean(disassembly.fromRMV)) {
    changes.disassemblyFromRMV = [Boolean(disassembly.fromRMV), disassemblyFromRMV]
    disassembly.fromRMV = disassemblyFromRMV
    frameMount.set({ disassembly })
  }

  if (companyId !== frameMount.get('company')?.id) {
    changes.companyId = [frameMount.get('company')?.id, companyId]
    const company = await $getOrFail('Company', companyId, ['tags'])
    frameMount.set({ company })
    // override company tags
    company.get('tags') ? frameMount.set('tags', company.get('tags')) : frameMount.unset('tags')
  }
  if (companyPersonId !== frameMount.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [frameMount.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    frameMount.set({ companyPerson })
  }

  frameMount.get('status') === 1 && frameMount.set('status', 0)

  const audit = { user, fn: 'frame-mount-update', data: { changes, cubeChanges } }
  return frameMount.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-finalize', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  await validateOrderFinalize(frameMount)

  // check if any special formats need to be canceled early
  await earlyCancelSpecialFormats(frameMount)

  frameMount.set({ status: 3 })
  const audit = { user, fn: 'frame-mount-finalize' }
  await frameMount.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Sonderformat finalisiert.'
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-undo-finalize', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  frameMount.set({ status: 2.1 })
  const audit = { user, fn: 'frame-mount-undo-finalize' }
  await frameMount.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Finalisierung zurückgezogen.'
}, $internOrAdmin)

Parse.Cloud.define('frame-mount-remove', async ({ params: { id: frameMountId }, user }) => {
  const frameMount = await $getOrFail(FrameMount, frameMountId)
  if (frameMount.get('status') !== 0 && frameMount.get('status') !== 2) {
    throw new Error('Nur Entwürfe können gelöscht werden.')
  }
  return frameMount.destroy({ useMasterKey: true })
}, $internOrAdmin)
