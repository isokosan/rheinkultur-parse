const { ensureUniqueField } = require('@/utils')

const PrintPackage = Parse.Object.extend('PrintPackage')

Parse.Cloud.beforeSave(PrintPackage, async ({ object: printPackage }) => {
  await ensureUniqueField(printPackage, 'no')
})

Parse.Cloud.afterSave(PrintPackage, ({ object: printPackage, context: { audit } }) => { $audit(printPackage, audit) })

Parse.Cloud.afterDelete(PrintPackage, $deleteAudits)

const fetchPrintPackages = async function () {
  // TODO: watch for limit
  const items = await $query(PrintPackage)
    .limit(1000)
    .find({ useMasterKey: true })
  const response = {}
  for (const item of items) {
    const { no, type, price, media, faces } = item.attributes
    response[no] = {
      objectId: item.id,
      no,
      type,
      media,
      price,
      faces,
      createdAt: moment(item.createdAt).toISOString()
    }
  }
  const printPackages = Object.values(response)
  printPackages.sort((a, b) => {
    if (a.no.startsWith('ALDI') && !b.no.startsWith('ALDI')) {
      return 1
    }
    const noA = parseInt(a.no.replace('ALDI.', ''))
    const noB = parseInt(b.no.replace('ALDI.', ''))
    if (noA === noB) {
      return a.no > b.no ? 1 : -1
    }
    return noA > noB ? 1 : -1
  })
  return printPackages
}

Parse.Cloud.define('print-package-save', async ({
  params: {
    id: printPackageId,
    no,
    media,
    type,
    price,
    image,
    faces
  }, user
}) => {
  const printPackage = printPackageId
    ? await $getOrFail(PrintPackage, printPackageId, ['image'])
    : new PrintPackage({ no })

  for (const key of Object.keys(faces)) {
    if (faces[key] < 1) {
      delete faces[key]
    }
  }

  const changes = $changes(printPackage, { media, type, price, image, faces })
  printPackage.set({
    media,
    type,
    price,
    image: image ? $parsify('FileObject', image.objectId) : undefined,
    faces
  })
  const audit = printPackageId
    ? { user, fn: 'print-package-update', data: { changes } }
    : { user, fn: 'print-package-create' }
  return printPackage.save(null, { useMasterKey: true, context: { audit } })
}, {
  requireUser: true,
  fields: {
    no: {
      type: String,
      required: true
    },
    media: {
      type: String,
      required: true
    },
    price: {
      type: Number,
      required: true
    }
  }
})

module.exports = {
  fetchPrintPackages
}
