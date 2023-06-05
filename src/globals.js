global.BASE_DIR = __dirname
global.DEVELOPMENT = process.env.NODE_ENV !== 'production'
global.consola = require('consola')
global.moment = require('moment')
moment.locale('de')
const { difference, isEqual } = require('lodash')

global.$cleanDict = (dict) => {
  if (!dict) { return null }
  for (const key in dict) {
    if (dict[key] === undefined) {
      delete dict[key]
    }
  }
  return Object.keys(dict).length > 0 ? dict : null
}

global.$parsify = (className, objectId) => {
  const Item = Parse.Object.extend(className)
  const item = new Item()
  item.id = objectId
  return item
}
global.$geopoint = (...args) => new Parse.GeoPoint(...args)
global.$pointer = (className, objectId) => $parsify(className, objectId).toPointer()
global.$query = className => new Parse.Query(className)
global.$attr = (object, key) => typeof object.get === 'function' ? object.get(key) : object[key]
global.$getOrFail = function (className, objectId, include) {
  const query = $query(className)
  include && query.include(include)
  return query.get(objectId, { useMasterKey: true })
    .catch((error) => {
      if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, `${className} existiert nicht`)
      }
    })
}

global.$pk = (obj) => {
  const stateId = obj.get?.('state')?.id || obj.state?.objectId
  if (!stateId) { return }
  const ort = obj.get?.('ort') || obj.ort
  return [stateId, ort].join(':')
}

global.$adminOnly = function ({ user, master }) {
  if (master) { return true }
  if (user?.get('accType') === 'admin') { return true }
  throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Validation Error')
}
global.$internOrAdmin = function ({ user, master }) {
  if (master) { return true }
  if (['intern', 'admin'].includes(user?.get('accType'))) { return true }
  throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Validation Error')
}
global.$internBookingManager = function ({ user, master }) {
  if (master) { return true }
  if (['intern', 'admin'].includes(user?.get('accType'))) {
    if (user.get('permissions').includes('manage-bookings')) {
      return true
    }
  }
  throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Validation Error')
}
global.$scoutManagerOrAdmin = function ({ user, master }) {
  if (master) { return true }
  if (user?.get('accType') === 'admin') { return true }
  if (['intern', 'partner'].includes(user?.get('accType'))) {
    if (user.get('permissions')?.includes('manage-scouts')) {
      return true
    }
  }
  throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Validation Error')
}

global.$wawiStart = '2023-01-01'
global.$today = async () => DEVELOPMENT
  ? await Parse.Config.get().then(config => config.get('today') || moment().format('YYYY-MM-DD'))
  : moment().format('YYYY-MM-DD')

const CUBE_LIMIT = 1000
global.$cubeLimit = (count) => {
  if (count > CUBE_LIMIT) {
    throw new Error('Sie dürfen nicht mehr als ' + CUBE_LIMIT + ' CityCubes hinterlegen.')
  }
}

// PARSE SDK BUG with objectId encoding: When saving the parse js sdk is not encoding the ID so we have to do it ourselves before saving
global.$saveWithEncode = function (object, ...args) {
  if (object.id) {
    object.id = encodeURIComponent(object.id)
  }
  return object.save(...args)
}

function normalizeAuditValue (value) {
  if (value === undefined || value === null) {
    return null
  }
  if (value?.toJSON) {
    value = value.toJSON()
  }
  if (value?.thumb && value.name) {
    return {
      name: value.name,
      url: value.thumb._url || value.thumb.url
    }
  }
  return value
}

global.$changes = function (item, fields, rawObject = false) {
  const response = {}
  for (const key of Object.keys(fields)) {
    const oldValue = normalizeAuditValue(rawObject ? item[key] : item.get(key))
    const newValue = normalizeAuditValue(fields[key])
    if (!isEqual(oldValue, newValue)) {
      if (key !== 'form') {
        response[key] = [oldValue, newValue]
        continue
      }
      // this is for nested forms in objects (scout submissions)
      // when using the form the keys within the form should not exits in the fields
      for (const formKey of Object.keys(newValue)) {
        const oldFormValue = oldValue.form[formKey]
        const newFormValue = newValue.form[formKey]
        if (!isEqual(oldFormValue, newFormValue)) {
          response[formKey] = [oldFormValue, newFormValue]
        }
      }
    }
  }
  return response
}

global.$cubeChanges = function (item, cubeIds) {
  let changed = false
  const cubeChanges = {}
  const added = difference(cubeIds, item.get('cubeIds'))
  if (added.length) {
    changed = true
    cubeChanges.added = added
  }
  const removed = difference(item.get('cubeIds'), cubeIds)
  if (removed.length) {
    changed = true
    cubeChanges.removed = removed
  }
  return changed ? cubeChanges : null
}
