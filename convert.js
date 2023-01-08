// https://epsg.io/31492
const proj4 = require('proj4')
const fs = require('fs')
const { buffer } = fs.readFileSync('BETA2007.gsb')
proj4.nadgrid('BETA2007.gsb', buffer)
proj4.defs('EPSG:31466', '+proj=tmerc +lat_0=0 +lon_0=6 +k=1 +x_0=2500000 +y_0=0 +ellps=bessel +nadgrids=BETA2007.gsb +units=m +no_defs +type=crs')
proj4.defs('EPSG:31467', '+proj=tmerc +lat_0=0 +lon_0=9 +k=1 +x_0=3500000 +y_0=0 +ellps=bessel +nadgrids=BETA2007.gsb +units=m +no_defs +type=crs')
proj4.defs('EPSG:31468', '+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel +nadgrids=BETA2007.gsb +units=m +no_defs +type=crs')
proj4.defs('EPSG:31469', '+proj=tmerc +lat_0=0 +lon_0=15 +k=1 +x_0=5500000 +y_0=0 +ellps=bessel +nadgrids=BETA2007.gsb +units=m +no_defs +type=crs')

const ZONES = {
  2: 'EPSG:31466',
  3: 'EPSG:31467',
  4: 'EPSG:31468',
  5: 'EPSG:31469'
}

function convertGaussKruger (x, y) {
  x = parseInt(x)
  y = parseInt(y)
  const fromDef = ZONES[`${x}`[0]]
  if (!fromDef) {
    throw new Error(`no epsg definition def for x: ${x}, y: ${y}`)
  }
  const [lon, lat] = proj4(fromDef, 'EPSG:4326', [x, y])
  return { lat, lon }
}

module.exports = convertGaussKruger
