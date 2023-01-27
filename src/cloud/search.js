const client = require('@/services/elastic')

const INDEXES = {
  'rheinkultur-streets-autocomplete': {
    config: {
      mappings: {
        properties: {
          street: {
            type: 'search_as_you_type'
          }
        }
      }
    },
    parseQuery: $query('Cube').distinct('str'),
    datasetMap: streets => streets.map(street => ({
      _id: street,
      doc: { street }
    }))
  },
  'rheinkultur-cities-autocomplete': {
    config: {
      mappings: {
        properties: {
          city: {
            type: 'search_as_you_type'
          }
        }
      }
    },
    parseQuery: $query('Cube').distinct('ort'),
    datasetMap: cities => cities.map(city => ({
      _id: city,
      doc: { city }
    }))
  },
  'rheinkultur-cubes': {
    config: {
      mappings: {
        properties: {
          gp: { type: 'geo_point' }
        }
      }
    },
    parseQuery: $query('Cube').include(['deleted']),
    datasetMap: cubes => cubes.map(cube => ({
      _id: cube.id,
      doc: {
        id: cube.id,
        lc: cube.get('lc'),
        media: cube.get('media'),
        htId: cube.get('ht')?.id,
        hti: cube.get('hti'),

        // address
        str: cube.get('str'),
        hsnr: cube.get('hsnr'),
        plz: cube.get('plz'),
        ort: cube.get('ort'),
        stateId: cube.get('state')?.id,
        gp: {
          lat: cube.get('gp').latitude,
          lon: cube.get('gp').longitude
        },

        dAt: cube.get('dAt'),
        cAt: cube.get('cAt'),
        sAt: cube.get('sAt'),
        vAt: cube.get('vAt'),

        // warnings
        bPLZ: cube.get('bPLZ'),
        nMR: cube.get('nMR'),
        MBfD: cube.get('MBfD'),
        PG: cube.get('PG'),
        Agwb: cube.get('Agwb'),
        TTMR: cube.get('TTMR'),

        // status (calculated attribute)
        s: cube.get('s'),
        order: cube.get('order'),
        klsId: cube.get('importData')?.klsId
      }
    }))
  }
}

const autocompleteSearch = async function (index, key, query) {
  const { hits: { hits } } = await client.search({
    index,
    size: 20,
    body: {
      query: {
        match_phrase_prefix: {
          [key]: query
        }
      }
    }
  })
  return hits.map(hit => hit._id)
}

Parse.Cloud.define('streets-autocomplete', ({ params: { query } }) => autocompleteSearch('rheinkultur-streets-autocomplete', 'street', query), { validateMasterKey: true })
Parse.Cloud.define('cities-autocomplete', ({ params: { query } }) => autocompleteSearch('rheinkultur-cities-autocomplete', 'city', query), { validateMasterKey: true })

Parse.Cloud.define('search', async ({
  params: {
    id,
    klsId,
    media,
    ht: htId,
    lc,
    str,
    hsnr,
    plz,
    ort,
    state: stateId,
    c,
    r,
    s,
    ml,
    cId,
    verifiable,
    from,
    pagination,
    returnQuery
  }
}) => {
  // BUILD QUERY

  const bool = { should: [], must: [], must_not: [], filter: [] }
  const sort = ['_score']
  id && bool.must.push({ match_phrase_prefix: { id } })
  klsId && bool.filter.push({ match_phrase_prefix: { klsId } })
  lc && bool.filter.push({ term: { 'lc.keyword': lc } })
  media && bool.filter.push({ term: { 'media.keyword': media } })
  htId && bool.filter.push({ term: { 'htId.keyword': htId } })
  str && bool.filter.push({ term: { 'str.keyword': str } })
  hsnr && bool.filter.push({ match_phrase_prefix: { hsnr } })
  plz && bool.filter.push({ match_phrase_prefix: { plz } })
  ort && bool.filter.push({ term: { 'ort.keyword': ort } })
  stateId && bool.filter.push({ term: { 'stateId.keyword': stateId } })

  if (c) {
    const [lon, lat] = c.split(',').map(parseFloat)
    bool.filter.push({
      geo_distance: {
        distance: (r || 1000000) + 'm',
        gp: { lat, lon }
      }
    })
    // https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html#geo-sorting
    sort.unshift({
      _geo_distance: {
        gp: { lat, lon },
        order: 'asc',
        // unit : 'km', // default m
        mode: 'min',
        distance_type: 'plane', // How to compute the distance. Can either be arc (default), or plane (faster, but inaccurate on long distances and close to the poles).
        ignore_unmapped: true
      }
    })
  } else {
    // https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html#geo-sorting
    sort.unshift({ 'id.keyword': 'asc' })
    !id && sort.unshift({ 'str.keyword': 'asc' })
  }

  if (verifiable) {
    const requiredFields = ['htId', 'str', 'hsnr', 'plz', 'ort', 'stateId']
    bool.must.push(...requiredFields.map(field => ({
      bool: {
        filter: { exists: { field } },
        must_not: { term: { [`${field}.keyword`]: '' } }
      }
    })))
  }

  // ml case
  let className, objectId
  if (s === 'ml' && ml) {
    [className, objectId] = ml.split('-')
  }
  if (!s) {
    // no initial filter
    bool.must_not.push({ exists: { field: 'bPLZ' } })
    bool.must_not.push({ exists: { field: 'nMR' } })
    bool.must_not.push({ exists: { field: 'MBfD' } })
    bool.must_not.push({ exists: { field: 'PG' } })
    bool.must_not.push({ exists: { field: 'Agwb' } })
    bool.must_not.push({ exists: { field: 'dAt' } })
  } else {
    switch (s) {
    case '0':
      bool.must.push({
        bool: {
          should: [
            { bool: { must_not: { exists: { field: 's' } } } },
            { term: { s } }
          ],
          minimum_should_match: 1
        }
      })
      break
    case 'available':
      bool.must.push({
        bool: {
          should: [
            { bool: { must_not: { exists: { field: 'order' } } } },
            { bool: { must_not: { exists: { field: 'nMR' } } } },
            { bool: { must_not: { exists: { field: 'MBfD' } } } },
            { bool: { must_not: { exists: { field: 'PG' } } } },
            { bool: { must_not: { exists: { field: 'Agwb' } } } },
            { bool: { must_not: { exists: { field: 'TTMR' } } } }
          ],
          minimum_should_match: 1
        }
      })
      break
    case '2':
      bool.must.push({ exists: { field: 'sAt' } })
      bool.must_not.push({ exists: { field: 'vAt' } })
      break
    case '3':
      bool.must.push({ exists: { field: 'vAt' } })
      break
    case '5':
      bool.must.push({ term: { s } })
      cId && bool.must.push({ match: { 'order.company.objectId': cId } })
      break
    case '7':
      bool.must.push({ exists: { field: 'TTMR' } })
      break
    case '8':
      bool.must.push({
        bool: {
          should: [
            { exists: { field: 'bPLZ' } },
            { exists: { field: 'nMR' } },
            { exists: { field: 'MBfD' } },
            { exists: { field: 'PG' } },
            { exists: { field: 'Agwb' } }
          ],
          minimum_should_match: 1
        }
      })
      break
    case '9':
      bool.must.push({ exists: { field: 'dAt' } })
      break
    case 'ml':
      bool.filter.push({ terms: { 'id.keyword': await $query(className).select('cubeIds').get(objectId, { useMasterKey: true }).then(marklist => marklist.get('cubeIds')) } })
      break
    default:
      bool.must.push({ exists: { field: s } })
      break
    }
  }

  if (returnQuery) {
    return {
      index: 'rheinkultur-cubes',
      query: { bool },
      sort
    }
  }
  const searchResponse = await client.search({
    index: 'rheinkultur-cubes',
    body: {
      query: { bool },
      sort,
      track_total_hits: true
    },
    from,
    size: pagination || 50
  })
  const { hits: { hits, total: { value: count } } } = searchResponse
  return { hits, count }
}, { validateMasterKey: true })

// Before is only defined if address is changing
const indexCube = async (cube, before) => {
  // overwrite or create the document
  const [{ _id: id, doc: body }] = INDEXES['rheinkultur-cubes'].datasetMap([cube])
  await client.index({ index: 'rheinkultur-cubes', id, body })

  if (!before) {
    return
  }

  // If updated and different, and none other exists check and remove before city
  const beforeCity = before?.ort
  const city = cube.get('ort')
  if (beforeCity !== city) {
    if (beforeCity && !await $query('Cube').notEqualTo('objectId', cube.id).equalTo('ort', beforeCity).first({ useMasterKey: true })) {
      await client.delete({ index: 'rheinkultur-cities-autocomplete', id: beforeCity }).then(consola.success).catch(consola.error)
    }
    await client.index({ index: 'rheinkultur-cities-autocomplete', id: city, body: { city } }).then(consola.success)
  }
  const beforeStreet = before?.str
  const street = cube.get('str')
  if (beforeStreet !== street) {
    if (beforeStreet && !await $query('Cube').notEqualTo('objectId', cube.id).equalTo('str', beforeStreet).first({ useMasterKey: true })) {
      await client.delete({ index: 'rheinkultur-streets-autocomplete', id: beforeStreet }).then(consola.success).catch(consola.error)
    }
    await client.index({ index: 'rheinkultur-streets-autocomplete', id: street, body: { street } })
  }
}

const unindexCube = async (cube) => {
  await client.delete({ index: 'rheinkultur-cubes', id: cube.id }).then(consola.success).catch(consola.error)
  const city = cube.get('ort')
  if (!await $query('Cube').notEqualTo('objectId', cube.id).equalTo('ort', city).first({ useMasterKey: true })) {
    await client.delete({ index: 'rheinkultur-cities-autocomplete', id: city }).then(consola.success).catch(consola.error)
  }
  const street = cube.get('str')
  if (!await $query('Cube').notEqualTo('objectId', cube.id).equalTo('str', street).first({ useMasterKey: true })) {
    await client.delete({ index: 'rheinkultur-streets-autocomplete', id: street }).then(consola.success).catch(consola.error)
  }
}

const purgeIndexes = async function () {
  for (const index of Object.keys(INDEXES)) {
    await client.indices.exists({ index }) && await client.indices.delete({ index })
    consola.success(`index deleted: ${index}`)
  }
  return 'ok'
}

Parse.Cloud.define('purge-search-indexes', purgeIndexes, { requireMaster: true })

module.exports = {
  client,
  INDEXES,
  purgeIndexes,
  indexCube,
  unindexCube
}
