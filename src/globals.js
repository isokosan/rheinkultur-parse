global.BASE_DIR = __dirname
global.DEVELOPMENT = process.env.NODE_ENV === 'development'
global.consola = require('consola')
global.moment = require('moment')
moment.locale('de')

global.$parsify = (className, objectId) => {
  const Item = Parse.Object.extend(className)
  const item = new Item()
  item.id = objectId
  return item
}
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
global.$adminOrMaster = function ({ user, master }) {
  if (master) {
    return true
  }
  if (user && user.get('accType') === 'admin') {
    return true
  }
  throw new Error('Validation Error')
}

global.$internOrMaster = function ({ user, master }) {
  if (master) {
    return true
  }
  if (user && ['admin', 'intern'].includes(user.get('accType'))) {
    return true
  }
  throw new Error('Validation Error')
}

global.$wawiStart = '2023-01-01'
global.$today = async () => DEVELOPMENT
  ? await Parse.Config.get().then(config => config.get('today') || moment().format('YYYY-MM-DD'))
  : moment().format('YYYY-MM-DD')

// TODO: Re-adjust limit later
const CUBE_LIMIT = 1000
global.$cubeLimit = (count) => {
  if (count > CUBE_LIMIT) {
    throw new Error('Sie dürfen nicht mehr als ' + CUBE_LIMIT + ' CityCubes hinterlegen.')
  }
}
