const sharp = require('sharp')
const mergeImages = require('merge-base64')
const { fromBase64 } = require('pdf2pic')
const { difference } = require('lodash')

const { PRINT_PACKAGE_FILES } = require('@/schema/enums')
const FileObject = Parse.Object.extend('FileObject')

Parse.Cloud.beforeSaveFile(async ({ file }) => {
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
  const contentType = file._source.type
  if (file._metadata.thumb) {
    return
  }
  const base64 = await file.getData()
  if (contentType.endsWith('pdf')) {
    const options = {
      format: 'png',
      width: null,
      height: 200,
      quality: 50,
      density: 36
    }
    return fromBase64(base64, options).bulk(-1, true)
      .then(pages => pages.map(page => page.base64))
      .then(mergeImages)
      .catch((error) => {
        consola.error(error)
        return null
      })
  }
  return sharp(Buffer.from(base64, 'base64'))
    .resize({ height: 200, fit: sharp.fit.contain })
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
  const thumb64 = await getThumbnailBase64(file)
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
    const production = await $query('Production').equalTo('objectId', productionId).first({ useMasterKey: true })
    if (production && production.get('printFiles')) {
      const usedFileIds = [...new Set(Object.values(production.get('printFiles'))
        .map(files => Object.values(files || {}).map(file => file.objectId))
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

Parse.Cloud.beforeSave('CubePhoto', async ({ object: cubePhoto }) => {
  const user = cubePhoto.get('createdBy')
  await user.fetch({ useMasterKey: true })
  if (user.get('accType') !== 'scout') {
    cubePhoto.set('approved', true)
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
