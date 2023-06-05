const HousingType = Parse.Object.extend('HousingType')
const { PRINT_PACKAGE_FILES } = require('@/schema/enums')
const { ensureUniqueField } = require('@/utils')

Parse.Cloud.beforeFind(HousingType, ({ query }) => {
  query._include.includes('files') && query.include(PRINT_PACKAGE_FILES)
})

Parse.Cloud.afterFind(HousingType, ({ objects }) => {
  for (const ht of objects) {
    ht.set('hasMissingTemplates', false)
    for (const file of PRINT_PACKAGE_FILES) {
      if (!ht.get(file)) {
        ht.set('hasMissingTemplates', true)
        continue
      }
    }
  }
  return objects
})

Parse.Cloud.beforeSave(HousingType, async ({ object: housingType }) => {
  await ensureUniqueField(housingType, 'code')
})

Parse.Cloud.afterSave(HousingType, ({ object: housingType, context: { audit } }) => {
  audit && $audit(housingType, audit)
})

Parse.Cloud.beforeDelete(HousingType, async ({ object: housingType }) => {
  const cube = await $query('Cube').equalTo('ht', housingType).first({ useMasterKey: true })
  if (cube) {
    throw new Error('Gehäusetyp kann nicht gelöscht werden, weil der Gehäusetyp einem CityCube zugeordnet ist.')
  }
})

Parse.Cloud.afterDelete(HousingType, $deleteAudits)

const fetchHousingTypes = async function () {
  // TODO: watch for limit
  const items = await $query(HousingType)
    .limit(1000)
    .ascending('code')
    .find({ useMasterKey: true })
  const response = {}
  for (const item of items) {
    const { code, media, hasMissingTemplates } = item.attributes
    response[item.id] = {
      objectId: item.id,
      code,
      media,
      hasMissingTemplates,
      // TODO: manage this
      createdAt: moment(item.createdAt).toISOString()
    }
  }
  return response
}

Parse.Cloud.define('housing-type-save', async ({
  params: {
    id: housingTypeId,
    code,
    media,
    ...files
  }, user
}) => {
  const housingType = housingTypeId
    ? await $getOrFail(HousingType, housingTypeId, PRINT_PACKAGE_FILES)
    : new HousingType()

  const changes = $changes(housingType, { code, media, ...files })
  housingType.set({ code, media })

  for (const key of Object.keys(files)) {
    const id = files[key]?.objectId || files[key]?.id
    id && PRINT_PACKAGE_FILES.includes(key)
      ? housingType.set(key, $pointer('FileObject', id))
      : housingType.unset(key)
  }

  const audit = housingTypeId
    ? { user, fn: 'housing-type-update', data: { changes } }
    : { user, fn: 'housing-type-create' }
  return housingType.save(null, { useMasterKey: true, context: { audit } })
}, $internOrAdmin)

Parse.Cloud.define('housing-type-remove', async ({ params: { id: housingTypeId } }) => {
  const housingType = await $getOrFail(HousingType, housingTypeId)
  return housingType.destroy({ useMasterKey: true })
}, $internOrAdmin)

module.exports = {
  fetchHousingTypes
}
