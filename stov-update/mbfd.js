require('dotenv').config()
global.Parse = require('parse/node')
Parse.serverURL = process.env.PRODUCTION_SERVER_URL
// Parse.serverURL = process.env.PUBLIC_SERVER_URL
console.log(Parse.serverURL)
Parse.initialize(process.env.APP_ID, process.env.JAVASCRIPT_KEY, process.env.MASTER_KEY)
require('./../src/globals')

const hasAusbautreiber = $query('Cube')
  .equalTo('lc', 'TLK')
  .matches('importData.ausbautreiber', '^MBfD')
const doesNotHaveAusbautreiber = Parse.Query.or(
  $query('Cube').equalTo('importData.ausbautreiber', null),
  $query('Cube').matches('importData.ausbautreiber', '^(?!MBfD).*')
)
  .equalTo('lc', 'TLK')
// hasAusbautreiber.count({ useMasterKey: true }).then(count => consola.info('Has ausbautreiber:', count))
// doesNotHaveAusbautreiber.count({ useMasterKey: true }).then(count => consola.info('Doesnt have ausbautreiber:', count))

hasAusbautreiber
  .notEqualTo('MBfD', true)
  .count({ useMasterKey: true })
  .then(count => consola.info('Ausbautreiber but does not have MBfD:', count))
  // .each(cube => {
  //   cube.set('MBfD', true)
  //   return $saveWithEncode(cube, null, { useMasterKey: true })
  //  }, { useMasterKey: true })

doesNotHaveAusbautreiber
  .equalTo('MBfD', true)
  .count({ useMasterKey: true })
  .then(count => consola.info('MBfD but does not have ausbautreiber:', count))
  // .each(cube => {
  //   cube.unset('MBfD')
  //   return $saveWithEncode(cube, null, { useMasterKey: true })
  //  }, { useMasterKey: true })

$query('Cube')
  .equalTo('lc', 'TLK')
  .matches('importData.ausbautreiber', '^MBfD')
  .count({ useMasterKey: true })
  .then(count => consola.info('Ausbautreiber:', count))

$query('Cube')
  .equalTo('lc', 'TLK')
  .equalTo('MBfD', true)
  .count({ useMasterKey: true })
  .then(count => consola.info('MBfD:', count))
