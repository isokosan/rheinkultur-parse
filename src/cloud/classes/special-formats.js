const { sum } = require('lodash')
const { specialFormats: { UNSET_NULL_FIELDS, normalizeFields } } = require('@/schema/normalizers')
const {
  getNewNo,
  validateOrderFinalize,
  setOrderCubeStatuses,
  getLastRemovedCubeIds
} = require('@/shared')

const SpecialFormat = Parse.Object.extend('SpecialFormat')

Parse.Cloud.beforeSave(SpecialFormat, async ({ object: specialFormat }) => {
  specialFormat.isNew() && !specialFormat.get('no') && specialFormat.set({ no: await getNewNo('SF' + moment(await $today()).format('YY') + '-', SpecialFormat, 'no') })
  UNSET_NULL_FIELDS.forEach(field => !specialFormat.get(field) && specialFormat.unset(field))

  specialFormat.set('totalDuration', (specialFormat.get('initialDuration') || 0) + (specialFormat.get('extendedDuration') || 0))
  const canceled = Boolean(specialFormat.get('canceledAt') || specialFormat.get('voidedAt'))
  !canceled && specialFormat.set('autoExtendsAt', specialFormat.get('autoExtendsBy') ? moment(specialFormat.get('endsAt')).subtract(specialFormat.get('noticePeriod') || 0, 'months').format('YYYY-MM-DD') : null)

  // cubes
  const cubeIds = specialFormat.get('cubeIds') || []
  if (cubeIds.length > CUBE_LIMIT) {
    throw new Error(`Es können maximal ${CUBE_LIMIT} CityCubes pro Auftrag hinzugefügt werden.`)
  }
  cubeIds.sort()
  specialFormat.set('cubeIds', cubeIds).set('cubeCount', cubeIds.length)
  specialFormat.set('sfCount', sum(Object.values(specialFormat.get('sfCounts') || {})))
})

Parse.Cloud.afterSave(SpecialFormat, async ({ object: specialFormat, context: { audit, setCubeStatuses } }) => {
  setCubeStatuses && await setOrderCubeStatuses(specialFormat)
  audit && $audit(specialFormat, audit)
})

Parse.Cloud.beforeFind(SpecialFormat, ({ query }) => {
  query._include.includes('all') && query.include([
    'company',
    'docs',
    'tags',
    'lastRemovedCubeIds'
  ])
})

Parse.Cloud.afterFind(SpecialFormat, async ({ objects: specialFormats, query }) => {
  for (const specialFormat of specialFormats) {
    // get computed property willExtend
    const willExtend = specialFormat.get('autoExtendsBy') && !specialFormat.get('canceledAt') && !specialFormat.get('voidedAt')
    specialFormat.set('willExtend', willExtend)

    if (query._include.includes('lastRemovedCubeIds') && specialFormat.get('status') >= 0 && specialFormat.get('status') <= 2.1) {
      specialFormat.set('lastRemovedCubeIds', await getLastRemovedCubeIds('SpecialFormat', specialFormat.id))
    }
  }
  return specialFormats
})

Parse.Cloud.beforeDelete(SpecialFormat, async ({ object: specialFormat }) => {
  if (specialFormat.get('status') !== 0 && specialFormat.get('status') !== 2) {
    throw new Error('Nur Aufträge im Entwurfsstatus können gelöscht werden!')
  }
})

Parse.Cloud.afterDelete(SpecialFormat, async ({ object: specialFormat }) => {
  $deleteAudits({ object: specialFormat })
})

Parse.Cloud.define('special-format-create', async ({ params, user, master }) => {
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
  const specialFormat = new SpecialFormat({
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
  const audit = { user, fn: 'special-format-create' }
  return specialFormat.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('special-format-update-cubes', async ({ params: { id: specialFormatId, ...params }, user }) => {
  const specialFormat = await $getOrFail(SpecialFormat, specialFormatId, 'company')
  if (specialFormat.get('status') >= 3) {
    throw new Error('CityCubes von finalisierte Aufträge können nicht mehr geändert werden.')
  }

  const { cubeIds } = normalizeFields(params)
  const cubeChanges = $cubeChanges(specialFormat, cubeIds)
  if (!cubeChanges) {
    throw new Error('Keine Änderungen')
  }
  specialFormat.set({ cubeIds })

  const audit = { user, fn: 'special-format-update', data: { cubeChanges } }
  return specialFormat.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('special-format-update', async ({ params: { id: specialFormatId, sfCounts, ...params }, user }) => {
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

  const specialFormat = await $getOrFail(SpecialFormat, specialFormatId, ['all'])
  if (specialFormat.get('status') >= 3) {
    throw new Error('Finalisierte Aufträge können nicht mehr geändert werden.')
  }

  for (const cubeId of cubeIds) {
    sfCounts[cubeId] = sfCounts?.[cubeId] || 1
  }
  sfCounts = $cleanDict(sfCounts, cubeIds)
  specialFormat.set('sfCounts', sfCounts)

  $cubeLimit(cubeIds.length)
  const cubeChanges = $cubeChanges(specialFormat, cubeIds)
  cubeChanges && specialFormat.set({ cubeIds })

  const changes = $changes(specialFormat, {
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    sfCounts
  })
  specialFormat.set({
    motive,
    externalOrderNo,
    campaignNo,
    startsAt,
    initialDuration,
    endsAt,
    noticePeriod,
    autoExtendsBy,
    sfCounts
  })

  const disassembly = specialFormat.get('disassembly') || {}
  // add disassemblyFromRMV
  if (disassemblyFromRMV !== Boolean(disassembly.fromRMV)) {
    changes.disassemblyFromRMV = [Boolean(disassembly.fromRMV), disassemblyFromRMV]
    disassembly.fromRMV = disassemblyFromRMV
    specialFormat.set({ disassembly })
  }

  if (companyId !== specialFormat.get('company')?.id) {
    changes.companyId = [specialFormat.get('company')?.id, companyId]
    const company = await $getOrFail('Company', companyId, ['tags'])
    specialFormat.set({ company })
    // override company tags
    company.get('tags') ? specialFormat.set('tags', company.get('tags')) : specialFormat.unset('tags')
  }
  if (companyPersonId !== specialFormat.get('companyPerson')?.id) {
    const companyPerson = companyPersonId ? await $getOrFail('Person', companyPersonId) : null
    changes.companyPerson = [specialFormat.get('companyPerson')?.get('fullName'), companyPerson?.get('fullName')]
    specialFormat.set({ companyPerson })
  }

  specialFormat.get('status') === 1 && specialFormat.set('status', 0)

  const audit = { user, fn: 'special-format-update', data: { changes, cubeChanges } }
  return specialFormat.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('special-format-finalize', async ({ params: { id: specialFormatId }, user }) => {
  const specialFormat = await $getOrFail(SpecialFormat, specialFormatId)
  await validateOrderFinalize(specialFormat)

  specialFormat.set({ status: 3 })
  const audit = { user, fn: 'special-format-finalize' }
  await specialFormat.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Sonderformat finalisiert.'
}, $internOrAdmin)

Parse.Cloud.define('special-format-undo-finalize', async ({ params: { id: specialFormatId }, user }) => {
  const specialFormat = await $getOrFail(SpecialFormat, specialFormatId)
  specialFormat.set({ status: 2.1 })
  const audit = { user, fn: 'special-format-undo-finalize' }
  await specialFormat.save(null, { useMasterKey: true, context: { audit, setCubeStatuses: true } })
  return 'Finalisierung zurückgezogen.'
}, $internOrAdmin)

Parse.Cloud.define('special-format-remove', async ({ params: { id: specialFormatId }, user }) => {
  const specialFormat = await $getOrFail(SpecialFormat, specialFormatId)
  if (specialFormat.get('status') !== 0 && specialFormat.get('status') !== 2) {
    throw new Error('Nur Entwürfe können gelöscht werden.')
  }
  return specialFormat.destroy({ useMasterKey: true })
}, $internOrAdmin)
