const sharp = require('sharp')
const mergeImages = require('merge-base64')
const { fromBase64 } = require('pdf2pic')
const { difference } = require('lodash')

const { PRINT_PACKAGE_FILES } = require('@/schema/enums')
const FileObject = Parse.Object.extend('FileObject')

Parse.Cloud.beforeSaveFile(async ({ file }) => {
  if (file._metadata.name) {
    file._metadata.name = encodeURIComponent(file._metadata.name)
  }
  const extension = file._name.split('.').reverse()[0].toLowerCase()
  if (['jpeg', 'jpg'].includes(extension)) {
    const base64 = await sharp(Buffer.from(await file.getData(), 'base64'))
      .jpeg({ mozjpeg: true })
      .withMetadata()
      .toBuffer()
      .then(data => data.toString('base64'))
    return new Parse.File(file._name, { base64 }, undefined, file._metadata, file._tags)
  }
})

const getThumbnailBase64 = async (file) => {
  if (file._metadata.thumb) {
    return
  }
  const contentType = file._source.type
  const base64 = await file.getData()
  if (contentType.endsWith('pdf')) {
    const options = {
      format: 'png',
      width: null,
      height: 270,
      quality: 70,
      density: 36
    }
    return fromBase64(base64, options).bulk(-1, true)
      .then(pages => pages.map(page => page.base64))
      .then(mergeImages)
  }
  return sharp(Buffer.from(base64, 'base64'))
    .resize({ height: 270, width: 270, fit: sharp.fit.inside })
    .withMetadata()
    .toBuffer()
    .then(data => data.toString('base64'))
}

const getSize1000Base64 = async (file) => {
  if (file._metadata.thumb) {
    return
  }
  const base64 = await file.getData()
  return sharp(Buffer.from(base64, 'base64'))
    .resize({ height: 1000, width: 1000, fit: sharp.fit.inside })
    .withMetadata()
    .toBuffer()
    .then(data => data.toString('base64'))
    .catch((error) => {
      consola.error(error)
      return null
    })
}

Parse.Cloud.afterSaveFile(async ({ file, fileSize, user, headers }) => {
  const name = file._metadata.name
  const { assetType, cubeId } = file.tags()
  let thumb64
  try {
    thumb64 = await getThumbnailBase64(file)
  } catch (error) {
    // abort save and delete file instead if thumbnail errors
    await file.destroy({ useMasterKey: true })
    consola.error(error)
    error.message = `Datei ist beschädigt: ${error.message}.`
    throw error
  }
  let thumb
  if (thumb64) {
    thumb = new Parse.File('thumb.png', { base64: thumb64 }, 'image/png', { thumb: 'true' })
    await thumb.save({ useMasterKey: true })
  }
  if (cubeId) {
    const cubePhoto = new Parse.Object('CubePhoto')
    cubePhoto.set({ cubeId, file, thumb, createdBy: user })
    return cubePhoto.save(null, { useMasterKey: true })
  }
  if (!assetType) {
    return
  }
  const fileObject = new Parse.Object('FileObject')
  const ext = name.split('.').reverse()[0]
  fileObject.set({ file, name, ext, thumb, fileSize, contentType: file._source.type, assetType, createdBy: user })
  await fileObject.save(null, { useMasterKey: true })
  return fileObject
})

// TODO: change this to asset type map
const FILE_OBJECT_REFERENCES = {
  PrintPackage: ['image'],
  HousingType: PRINT_PACKAGE_FILES,
  Company: ['docs'],
  Contract: ['docs'],
  Booking: ['docs'],
  Invoice: ['docs'],
  CreditNote: ['docs']
}

Parse.Cloud.afterFind(FileObject, ({ objects }) => {
  for (const object of objects) {
    object.set('name', decodeURIComponent(object.get('name')))
  }
})

// The FileObject will not be deleted unless the file associated with it is successfuly deleted, or is already not found
Parse.Cloud.beforeDelete(FileObject, async ({ object }) => {
  // check for references of this FileObject
  const references = await Promise.all(Object.keys(FILE_OBJECT_REFERENCES).map((className) => {
    return Parse.Query.or(...FILE_OBJECT_REFERENCES[className].map((field) => {
      return (new Parse.Query(className)).equalTo(field, object)
    })).find({ useMasterKey: true })
  })).then(references => references.flat())
  if (references.length) {
    throw new Error(`Referenced in ${references.length} objects: ` + references.map(({ className, id }) => className + ' ' + id).join(', '))
  }

  // if the file is a print file for production, then check the assembly printFiles for references
  if (object.get('assetType')?.startsWith('Production_')) {
    const productionId = object.get('assetType').split('_')[1]
    const production = await $query('Production').get(productionId, { useMasterKey: true })
    if (production && production.get('printFiles')) {
      const usedFileIds = [...new Set(Object.values(production.get('printFiles'))
        .map(files => Object.values(files || {}).map(file => file.id))
        .flat()
      )]
      if (usedFileIds.includes(object.id)) {
        throw new Error('In production!!!')
      }
    }
  }

  return Promise.all([
    object.get('file')?.destroy({ useMasterKey: true }), // deletes file if exists
    object.get('thumb')?.destroy({ useMasterKey: true }) // deletes thumb if exists
  ])
})

Parse.Cloud.beforeFind('CubePhoto', async ({ query, user, master }) => {
  const isPublic = !user && !master
  isPublic && query.equalTo('approved', true)
  // TODO: constrain photos to only those of the user's cubes if not approved
})

Parse.Cloud.beforeSave('CubePhoto', async ({ object: cubePhoto }) => {
  const user = cubePhoto.get('createdBy')
  await user.fetch({ useMasterKey: true })
  if (user.get('accType') !== 'scout') {
    cubePhoto.set('approved', true)
  }
})

Parse.Cloud.afterSave('CubePhoto', async ({ object: cubePhoto }) => {
  if (!cubePhoto.get('size1000')) {
    const base64 = await getSize1000Base64(cubePhoto.get('file'))
    const size1000 = new Parse.File('size1000.png', { base64 }, 'image/png', { thumb: 'size1000' })
    await size1000.save({ useMasterKey: true })
    cubePhoto.set({ size1000 })
    await cubePhoto.save(null, { useMasterKey: true })
  }
})

// The CubePhoto will not be deleted unless the file associated with it is successfuly deleted, or is already not found
Parse.Cloud.beforeDelete('CubePhoto', async ({ object }) => {
  const cube = await $getOrFail('Cube', object.get('cubeId'))
  if (cube.get('p1')?.id === object.id) {
    throw new Error('Als Front verwendetes Foto kann nicht gelöscht werden.')
  }
  if (cube.get('p2')?.id === object.id || cube.get('p3')?.id === object.id) {
    throw new Error('Als Umfeldfoto verwendetes Foto kann nicht gelöscht werden.')
  }
  return Promise.all([
    object.get('file')?.destroy({ useMasterKey: true }), // deletes file if exists
    object.get('thumb')?.destroy({ useMasterKey: true }) // deletes thumb if exists
  ])
})

Parse.Cloud.define('storage-update-name', async ({ params: { id, name } }) => {
  const fileObject = await (new Parse.Query(FileObject)).get(id, { useMasterKey: true })
  fileObject.set({ name })
  return fileObject.save(null, { useMasterKey: true })
})

Parse.Cloud.define('storage-delete', async ({ params: { id } }) => {
  const fileObject = await (new Parse.Query(FileObject)).get(id, { useMasterKey: true })
  return fileObject.destroy({ useMasterKey: true })
})

Parse.Cloud.define('item-docs', async ({ params: { itemId, itemClass, docIds }, user }) => {
  const item = await $getOrFail(itemClass, itemId, ['docs'])
  const beforeDocIds = (item.get('docs') || []).map(d => d.id)
  const data = {}
  const added = difference(docIds, beforeDocIds)
  if (added.length) {
    data.added = await $query('FileObject')
      .containedIn('objectId', added)
      .select('name')
      .find({ useMasterKey: true })
      .then(items => items.map(fO => fO.get('name')))
  }
  const removed = difference(beforeDocIds, docIds)
  if (removed.length) {
    data.removed = removed.map(id => item.get('docs').find(fileObject => fileObject.id === id).get('name'))
  }
  if (!Object.keys(data).length) {
    throw new Error('Keine Änderungen')
  }

  docIds.length
    ? item.set({ docs: docIds.filter(x => x).map(id => $pointer('FileObject', id)) })
    : item.unset('docs')
  const audit = { user, fn: 'update-docs', data }
  await item.save(null, { useMasterKey: true, context: { audit } })
  return data.added ? 'Hinzugefügt.' : 'Entfernt.'
}, {
  requireUser: true,
  fields: {
    itemClass: {
      type: String,
      required: true
    },
    itemId: {
      type: String,
      required: true
    }
  }
})
