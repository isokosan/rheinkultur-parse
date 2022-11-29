global.BASE_DIR = __dirname
global.DEVELOPMENT = process.env.NODE_ENV === 'development'
global.consola = require('consola')
global.moment = require('moment')
moment.locale('de')

const CUBE_LIMIT = 500
global.$cubeLimit = (count) => {
  if (count > CUBE_LIMIT) {
    throw new Error('Sie dürfen nicht mehr als ' + CUBE_LIMIT + ' CityCubes hinterlegen.')
  }
}

global.$today = () => Parse.Config.get().then(config => config.get('today') || moment().format('YYYY-MM-DD'))

global.$parsify = (className, objectId) => {
  const Item = Parse.Object.extend(className)
  const item = new Item()
  item.id = objectId
  return item
}

global.$pointer = (className, objectId) => {
  return $parsify(className, objectId).toPointer()
}

global.$query = className => new Parse.Query(className)

global.$attr = (object, key) => typeof object.get === 'function' ? object.get(key) : object[key]

global.$getOrFail = async function (className, objectId, include) {
  const query = $query(className)
  include && query.include(include)
  try {
    const object = await query.get(objectId, { useMasterKey: true })
    return object
  } catch (error) {
    throw new Error(`${className} existiert nicht`)
  }
}
global.$geopoint = (...args) => new Parse.GeoPoint(...args)
