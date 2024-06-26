const sharp = require('sharp')
const mergeImages = require('merge-base64')
const { fromBase64 } = require('pdf2pic')
const { difference } = require('lodash')

const { PRINT_PACKAGE_FILES } = require('@/schema/enums')
const FileObject = Parse.Object.extend('FileObject')
const CubePhoto = Parse.Object.extend('CubePhoto')

function handleFileDestroyError (error) {
  consola.error('Skipped destroy file:', error.message)
}

const getThumbnail = async (file) => {
  if (file._metadata.thumb) { return }
  if (file._source?.type?.endsWith('pdf')) {
    const options = {
      format: 'png',
      width: null,
      height: 270,
      quality: 70,
      density: 36
    }
    const base64 = await fromBase64(await file.getData(), options).bulk(-1, { responseType: 'base64' })
      .then(pages => pages.map(page => page.base64))
      .then(mergeImages)
    return new Parse.File('thumb.png', { base64 }, 'image/png', { thumb: 'true' })
  }
  // try to generate thumb if image
  return sharp(Buffer.from(await file.getData(), 'base64'))
    .resize({ height: 270, width: 270, fit: sharp.fit.inside })
    .webp({ nearLossless: true })
    .rotate() // !! withMetadata after webp does not get orientation so rotate fixes that
    // .withMetadata()
    .toBuffer()
    .then(data => new Parse.File('thumb.webp', { base64: data.toString('base64') }, 'image/webp', { thumb: 'true' }))
    .catch((error) => {
      if (error.message !== 'Input buffer contains unsupported image format') {
        consola.error(error.code, error.message)
      }
      return null
    })
}

const getSize1000 = async (file) => {
  if (file._metadata.thumb) { return }
  const base64 = await sharp(Buffer.from(await file.getData(), 'base64'))
    .resize({ height: 1000, width: 1000, fit: sharp.fit.inside })
    .webp({ nearLossless: true })
    .rotate() // !! withMetadata after webp does not get orientation so rotate fixes that
    // .withMetadata()
    .toBuffer()
    .then(data => data.toString('base64'))
    .catch((error) => {
      handleFileDestroyError(error)
      return null
    })
  return new Parse.File('size1000.webp', { base64 }, 'image/webp', { thumb: 'size1000' })
}

const ALLOWED_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'apng',
  'avif',
  'webp',
  'svg',
  'gif'
]

Parse.Cloud.beforeSaveFile(async ({ file }) => {
  file._metadata.name && (file._metadata.name = encodeURIComponent(file._metadata.name))
  if (!file._metadata.thumb && file._source?.type.startsWith('image/')) {
    const extension = file._name.split('.').reverse()[0].toLowerCase()
    if (!ALLOWED_IMAGE_EXTENSIONS.includes(extension)) {
      throw new Error(`Dateiendung ${extension} nicht erlaubt.`)
    }
    if (extension === 'webp') { return }
    if (['jpeg', 'jpg'].includes(extension)) {
      const base64 = await sharp(Buffer.from(await file.getData(), 'base64'))
        .jpeg({ mozjpeg: true })
        .withMetadata()
        .toBuffer()
        .then(data => data.toString('base64'))
      return new Parse.File(file._name, { base64 }, undefined, file._metadata, file._tags)
    }
    if (extension === 'png') {
      const base64 = await sharp(Buffer.from(await file.getData(), 'base64'))
        .webp({ nearLossless: true })
        .withMetadata()
        .toBuffer()
        .then(data => data.toString('base64'))
      const replaceExtension = name => name.replace(new RegExp(`.${extension}$`), '.webp')
      file._metadata.name && (file._metadata.name = replaceExtension(file._metadata.name))
      return new Parse.File(replaceExtension(file._name), { base64 }, 'image/webp', file._metadata, file._tags)
    }
  }
})

Parse.Cloud.afterSaveFile(async ({ file, fileSize, user, headers }) => {
  const name = file._metadata.name
  const { assetType, cubeId, klsId, originalId, scope, form } = file.tags()
  let thumb
  try {
    thumb = await getThumbnail(file)
    thumb && await thumb.save({ useMasterKey: true })
  } catch (error) {
    // abort save and delete file instead if thumbnail errors
    await file.destroy({ useMasterKey: true })
    consola.error(error)
    error.message = `Datei ist beschädigt: ${error.message}.`
    throw error
  }
  if (cubeId) {
    const cubePhoto = new CubePhoto({ cubeId, klsId, file, thumb, createdBy: user, scope, form })
    return cubePhoto.save(null, { useMasterKey: true })
  }
  if (originalId) {
    const cubePhoto = await $getOrFail(CubePhoto, originalId)
    const original = cubePhoto.get('original') || cubePhoto.get('file')
    await cubePhoto.get('thumb')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError)
    cubePhoto.set({ original, file, thumb })
    return cubePhoto.save(null, { useMasterKey: true, context: { regenerateSize1000: true } })
  }

  if (!assetType) { return }

  const fileObject = new Parse.Object('FileObject')
  const ext = name.split('.').reverse()[0]
  fileObject.set({ file, name, ext, thumb, fileSize, contentType: file._source.type, assetType, createdBy: user })
  await fileObject.save(null, { useMasterKey: true })
  return fileObject
})

Parse.Cloud.beforeFind(CubePhoto, async ({ query, user, master }) => {
  if (master) { return }
  // if public, just return clean and approved photos.
  if (!user) {
    query
      .equalTo('approved', true)
      .equalTo('klsId', null) // temporary fix until KLS id is resolved
      .equalTo('scope', null)
    return
  }

  const isIntern = user && ['admin', 'intern'].includes(user.get('accType'))
  if (isIntern) {
    !query._where.scope && !query._include.includes('all') && query.equalTo('scope', null) // show assembly photos only if specified
    return
  }

  // if not intern constrain photos to only those of the scouts cubes

  // Unfortunately, matchesQuery inside an and or operator is not functioning
  // query.equalTo('klsId', null).equalTo('scope', null)
  // const userQuery = user.get('accType') === 'partner'
  //   ? $query(Parse.User).equalTo('company', user.get('company'))
  //   : $query(Parse.User).equalTo('objectId', user.id)
  // return Parse.Query.and(
  //   query,
  //   Parse.Query.or(
  //     $query(CubePhoto).equalTo('approved', true),
  //     $query(CubePhoto).matchesQuery('createdBy', userQuery)
  //   )
  // )

  // do not further constrain when assembly key is requested explicitly
  if (query._where.scope) { return }

  // so we have to pull the users instead
  const users = user.get('accType') === 'partner'
    ? await $query(Parse.User)
      .equalTo('company', user.get('company'))
      .distinct('objectId', { useMasterKey: true })
      .then(ids => ids.map(id => $pointer('_User', id)))
    : [user]
  return Parse.Query.and(
    query,
    Parse.Query.or(
      $query(CubePhoto).equalTo('approved', true),
      $query(CubePhoto).containedIn('createdBy', users)
    )
  )
})

Parse.Cloud.beforeSave(CubePhoto, async ({ object: cubePhoto, context: { regenerateThumb, regenerateSize1000 } }) => {
  if (regenerateThumb) {
    await cubePhoto.get('thumb')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError)
    cubePhoto.unset('thumb')
  }
  if (!cubePhoto.get('thumb')) {
    const thumb = await getThumbnail(cubePhoto.get('file'))
    await thumb.save({ useMasterKey: true })
    cubePhoto.set({ thumb })
  }
  if (regenerateSize1000) {
    await cubePhoto.get('size1000')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError)
    cubePhoto.unset('size1000')
  }
  if (!cubePhoto.get('size1000')) {
    const size1000 = await getSize1000(cubePhoto.get('file'))
    await size1000.save({ useMasterKey: true })
    cubePhoto.set({ size1000 })
  }

  if (!cubePhoto.get('approved')) {
    if (cubePhoto.get('scope')) { return }
    // form photos need to be manually approved
    if (cubePhoto.get('form')) { return }
    const user = cubePhoto.get('createdBy')
    if (!user) {
      cubePhoto.set('approved', true)
      return
    }
    await user.fetch({ useMasterKey: true })
    if (['admin', 'intern'].includes(user.get('accType'))) {
      cubePhoto.set('approved', true)
    }
  }
})

// The CubePhoto will not be deleted unless the file associated with it is successfuly deleted, or is already not found
Parse.Cloud.beforeDelete(CubePhoto, async ({ object, user, master }) => {
  const cube = await $getOrFail('Cube', object.get('cubeId'))
  if (cube.get('p1')?.id === object.id) {
    await cube.unset('p1').save(null, { useMasterKey: true })
  }
  if (cube.get('p2')?.id === object.id) {
    await cube.unset('p2').save(null, { useMasterKey: true })
  }
  return Promise.all([
    object.get('file')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError), // deletes file if exists
    object.get('original')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError), // deletes original if exists
    object.get('size1000')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError), // deletes size1000 if exists
    object.get('thumb')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError) // deletes thumb if exists
  ])
}, async ({ object, user, master }) => {
  if (master) { return true }
  if (!user) { throw new Error('Unerlaubte Aktion') }
  const accType = user.get('accType')
  if (['intern', 'admin'].includes(accType)) { return true }
  if (user.id === object.get('createdBy').id) { return true }
  if (accType === 'partner') {
    const uploader = object.get('createdBy')
    await uploader.fetch({ useMasterKey: true })
    const uploaderCompanyId = uploader.get('company').id
    if (user.get('company').id === uploaderCompanyId) { return true }
  }
  throw new Error('Unerlaubte Aktion')
})

// Run another p1 & p2 cleanup check after deletion
Parse.Cloud.afterDelete(CubePhoto, async ({ object }) => {
  const cube = await $getOrFail('Cube', object.get('cubeId'))
  if (cube.get('p1')?.id === object.id) {
    await cube.unset('p1').save(null, { useMasterKey: true })
  }
  if (cube.get('p2')?.id === object.id) {
    await cube.unset('p2').save(null, { useMasterKey: true })
  }
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
Parse.Cloud.beforeDelete(FileObject, async ({ object, user, master }) => {
  if (!master) {
    if (!user) { throw new Error('Unauthorized') }
    if (!['intern', 'admin'].includes(user.get('accType'))) { throw new Error('Unauthorized') }
  }

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
    object.get('file')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError), // deletes file if exists
    object.get('thumb')?.destroy({ useMasterKey: true }).catch(handleFileDestroyError) // deletes thumb if exists
  ])
})

Parse.Cloud.define('storage-update-name', async ({ params: { id, name } }) => {
  const fileObject = await (new Parse.Query(FileObject)).get(id, { useMasterKey: true })
  fileObject.set({ name })
  return fileObject.save(null, { useMasterKey: true })
}, $internOrAdmin)

Parse.Cloud.define('storage-delete', async ({ params: { id } }) => {
  const fileObject = await (new Parse.Query(FileObject)).get(id, { useMasterKey: true })
  return fileObject.destroy({ useMasterKey: true })
}, $internOrAdmin)

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
    ? item.set({ docs: docIds.filter(Boolean).map(id => $pointer('FileObject', id)) })
    : item.unset('docs')
  const audit = { user, fn: 'update-docs', data }
  await item.save(null, { useMasterKey: true, context: { audit } })
  return data.added ? 'Hinzugefügt.' : 'Entfernt.'
}, $internOrAdmin)
