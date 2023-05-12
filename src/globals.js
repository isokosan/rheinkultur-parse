global.BASE_DIR = __dirname
global.DEVELOPMENT = process.env.NODE_ENV === 'development'
global.consola = require('consola')
global.moment = require('moment')
moment.locale('de')

global.$cleanDict = (dict = {}) => {
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
