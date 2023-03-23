const client = require('@/services/elastic')

const INDEXES = {
  'rheinkultur-streets-autocomplete': {
    config: {
      mappings: {
        properties: {
          street: { type: 'search_as_you_type' }
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
          ort: { type: 'search_as_you_type' }
        }
      }
    },
    parseQuery: $query('City'),
    datasetMap: cities => cities.map(city => ({
      _id: city.id,
      doc: {
        objectId: city.id,
        ort: city.get('ort'),
        stateId: city.get('state').id,
        gp: city.get('gp')?.toJSON()
      }
    }))
  },
  'rheinkultur-cubes': {
    config: {
      mappings: {
        properties: {
          geo: { type: 'geo_point' }
          // hsnr: {
          //   type: 'text',
          //   fields: {
          //     // https://www.elastic.co/guide/en/elasticsearch/plugins/current/analysis-icu.html
          //     sort: {
          //       type: 'icu_collation_keyword',
          //       index: false,
          //       numeric: true,
          //       case_level: false
          //     }
          //   }
          // }
        }
      }
    },
    parseQuery: $query('Cube'),
    datasetMap: cubes => cubes.map(cube => ({
      _id: cube.id,
      doc: {
        objectId: cube.id,
        lc: cube.get('lc'),
        media: cube.get('media'),
        ht: cube.get('ht')
          ? { __type: 'Pointer', className: 'HousingType', objectId: cube.get('ht').id }
          : undefined,
        hti: cube.get('hti'),

        // address
        str: cube.get('str'),
        hsnr: cube.get('hsnr'),
        plz: cube.get('plz'),
        ort: cube.get('ort'),
        state: cube.get('state')
          ? { __type: 'Pointer', className: 'State', objectId: cube.get('state').id }
          : undefined,
        stateId: cube.get('state')?.id,
        gp: cube.get('gp')?.toJSON(),
        geo: {
          lat: cube.get('gp').latitude,
          lon: cube.get('gp').longitude
        },

        dAt: cube.get('dAt'),
        cAt: cube.get('cAt'),
        sAt: cube.get('sAt'),
        vAt: cube.get('vAt'),
        pOk: (cube.get('p1') && cube.get('p2')) ? true : undefined,

        // warnings
        bPLZ: cube.get('bPLZ'),
        PDGA: cube.get('PDGA'),
        nMR: cube.get('nMR'),
        MBfD: cube.get('MBfD'),
        PG: cube.get('PG'),
        Agwb: cube.get('Agwb'),
        TTMR: cube.get('TTMR'),

        klsId: cube.get('importData')?.klsId,
        order: cube.get('order'),

        // status (calculated attribute)
        s: cube.get('s')
      }
    }))
  },
  'rheinkultur-fieldwork': {
    config: {
      mappings: {
        properties: {
          geo: { type: 'geo_point' },
          status: {
            type: 'byte'
          }
        }
      }
    },
    parseQuery: $query('TaskList'),
    datasetMap: taskLists => taskLists.map(taskList => ({
      _id: taskList.id,
      doc: {
        objectId: taskList.id,
        type: taskList.get('type'),
        ort: taskList.get('ort'),
        stateId: taskList.get('state')?.id,
        status: taskList.get('status'),
        gp: taskList.get('gp')?.toJSON(),
        geo: {
          lat: taskList.get('gp').latitude,
          lon: taskList.get('gp').longitude
        },
        managerId: taskList.get('manager')?.id,
        scoutIds: taskList.get('scouts')?.map(scout => scout.id),
        date: taskList.get('date'),
        dueDate: taskList.get('dueDate')
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
      // TODO: implement script based sorting on elasticsearch level
      // sort: {
      //   _script: {
      //     type: 'number',
      //     script: {
      //       lang: "painless",
      //       source: `doc['${key}.keyword'].value.length()`
      //     },
      //     order: 'asc'
      //   }
      // }
    }
  })
  hits.sort((a, b) => a._id.length - b._id.length)
  return hits
}

Parse.Cloud.define(
  'streets-autocomplete',
  ({ params: { query } }) => autocompleteSearch('rheinkultur-streets-autocomplete', 'street', query)
    .then(hits => hits.map(hit => hit._id)),
  { validateMasterKey: true }
)
Parse.Cloud.define(
  'cities-autocomplete',
  ({ params: { query } }) => autocompleteSearch('rheinkultur-cities-autocomplete', 'ort', query)
    .then(hits => hits.map(hit => hit._source)),
  { validateMasterKey: true }
)

Parse.Cloud.define('search-fieldwork', async ({
  params: {
    // pk, // placeKey (stateId:ort)
    c,
    state: stateId,
    type,
    managerId,
    scoutId,
    status,
    from,
    pagination
  }, user, master
}) => {
  // BUILD QUERY
  const bool = { should: [], must: [], must_not: [], filter: [] }
  const sort = ['_score']

  type && bool.filter.push({ term: { 'type.keyword': type } })
  stateId && bool.filter.push({ term: { 'stateId.keyword': stateId } })
  managerId && bool.filter.push({ term: { 'managerId.keyword': managerId } })
  scoutId && bool.filter.push({ match: { scoutIds: scoutId } })
  if (status === 'must_appoint') {
    bool.filter.push({ term: { status: 0 } })
  } else if (status === 'must_assign') {
    bool.filter.push({ terms: { status: [0, 1] } })
  } else if (status === 'wip') {
    bool.filter.push({ terms: { status: [2, 3] } })
  } else if (status === 'done') {
    bool.filter.push({ term: { status: 4 } })
  }

  if (c) {
    const [lon, lat] = c.split(',').map(parseFloat)
    sort.unshift({
      _geo_distance: {
        geo: { lat, lon },
        order: 'asc',
        unit: 'km',
        mode: 'min',
        distance_type: 'plane',
        ignore_unmapped: true
      }
    })
  }

  const searchResponse = await client.search({
    index: 'rheinkultur-fieldwork',
    body: {
      query: { bool },
      sort,
      track_total_hits: true
    },
    from,
    size: pagination || 50
  })
  const { hits: { hits, total: { value: count } } } = searchResponse
  const taskLists = await $query('TaskList')
    .containedIn('objectId', hits.map(hit => hit._id))
    .limit(hits.length)
    .find({ useMasterKey: true })
  const results = hits.map(hit => {
    const obj = taskLists.find(obj => obj.id === hit._id)
    c && obj.set('distance', hit.sort[0])
    return obj.toJSON()
  })
  return { results, count }
}, { validateMasterKey: true })

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
    pk, // placeKey (stateId:ort)
    c,
    r,
    s,
    ml,
    cId,
    verifiable,
    isMap, // used to determine if query is coming from map and should only include limited fields
    from,
    pagination,
    returnQuery
  }, user, master
}) => {
  const isPublic = !master && !user
  if (isPublic && s !== '0' && s !== '') {
    s = ''
  }
  s = s?.split(',') || []

  // BUILD QUERY
  const bool = { should: [], must: [], must_not: [], filter: [] }
  const sort = ['_score']
  id && bool.must.push({ match_phrase_prefix: { objectId: id } })
  klsId && bool.filter.push({ match_phrase_prefix: { klsId } })
  lc && bool.filter.push({ term: { 'lc.keyword': lc } })
  media && bool.filter.push({ term: { 'media.keyword': media } })
  htId && bool.filter.push({ term: { 'ht.objectId.keyword': htId } })

  if (c) {
    const [lon, lat] = c.split(',').map(parseFloat)
    // if radius is specified add geo radius filter
    r && bool.filter.push({
      geo_distance: {
        distance: r + 'm',
        geo: { lat, lon }
      }
    })
    // https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html#geo-sorting
    // sort by distance if c is given (map)
    sort.unshift({
      _geo_distance: {
        geo: { lat, lon },
        order: 'asc',
        // unit : 'km', // default m
        mode: 'min',
        distance_type: 'plane', // How to compute the distance. Can either be arc (default), or plane (faster, but inaccurate on long distances and close to the poles).
        ignore_unmapped: true
      }
    })
  } else {
    // https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html#geo-sorting
    sort.unshift({ 'objectId.keyword': 'asc' })
    // !id && sort.unshift({ 'hsnr.sort': 'asc' })
    !id && sort.unshift({ 'str.keyword': 'asc' })
  }

  if (verifiable) {
    const requiredFields = ['ht', 'str', 'hsnr', 'plz', 'ort', 'state']
    bool.must.push(...requiredFields.map(field => ({
      bool: {
        filter: { exists: { field } },
        must_not: { term: { [`${field}.keyword`]: '' } }
      }
    })))
  }

  // STATUS PUBLIC
  // TODO: add filter for distributors (external users who are not scouts)
  isPublic && bool.must_not.push({ exists: { field: 'dAt' } })

  if (s.includes('0')) {
    bool.must.push({
      bool: {
        should: [
          { bool: { must_not: { exists: { field: 's' } } } },
          { range: { s: { lt: 5 } } }
        ],
        minimum_should_match: 1
      }
    })
  }

  if (ml) {
    const [className, objectId] = ml.split('-')
    s.includes('ml') && bool.filter.push({
      terms: {
        'objectId.keyword': await $query(className)
          .select('cubeIds')
          .get(objectId, { useMasterKey: true })
          .then(marklist => marklist.get('cubeIds'))
      }
    })
    if (className === 'TaskList') {
      const list = await $getOrFail(className, objectId)
      ort = list.get('ort')
      stateId = list.get('state').id
    }
  }

  // Booked
  if (s.includes('5')) {
    bool.must.push({ exists: { field: 'order' } })
    cId && bool.must.push({ match: { 'order.company.objectId': cId } })
  }
  // Nicht vermarktungsfähig
  s.includes('7') && bool.must.push({
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

  // single issues
  s.includes('sAt') && bool.must.push({ exists: { field: 'sAt' } })
  s.includes('vAt') && bool.must.push({ exists: { field: 'vAt' } })
  s.includes('nV') && bool.must_not.push({ exists: { field: 'vAt' } })
  s.includes('nP') && bool.must_not.push({ exists: { field: 'pOk' } })
  s.includes('TTMR') && bool.must.push({ exists: { field: 'TTMR' } })
  s.includes('bPLZ') && bool.must.push({ exists: { field: 'bPLZ' } })
  s.includes('PDGA') && bool.must.push({ exists: { field: 'PDGA' } })
  s.includes('nMR') && bool.must.push({ exists: { field: 'nMR' } })
  s.includes('MBfD') && bool.must.push({ exists: { field: 'MBfD' } })
  s.includes('PG') && bool.must.push({ exists: { field: 'PG' } })
  s.includes('Agwb') && bool.must.push({ exists: { field: 'Agwb' } })

  // Nicht gefunden
  s.includes('8') && bool.must.push({ exists: { field: 'dAt' } })

  // address constraints

  if (pk) {
    [stateId, ort] = pk.split(':')
  }

  str && bool.filter.push({ term: { 'str.keyword': str } })
  hsnr && bool.filter.push({ match_phrase_prefix: { hsnr } })
  plz && bool.filter.push({ match_phrase_prefix: { plz } })
  ort && bool.filter.push({ term: { 'ort.keyword': ort } })
  stateId && bool.filter.push({ term: { 'state.objectId.keyword': stateId } })

  if (returnQuery) {
    return {
      index: 'rheinkultur-cubes',
      query: { bool },
      sort
    }
  }

  const excludes = ['geo']
  let includes
  if (isPublic) {
    includes = [
      'objectId',
      'media',
      'str',
      'hsnr',
      'plz',
      'ort',
      'state',
      'stateId',
      'gp',
      's'
    ]
  }
  if (isMap) {
    includes = [
      'objectId',
      'gp',
      's'
    ]
  }

  const searchResponse = await client.search({
    index: 'rheinkultur-cubes',
    body: {
      query: { bool },
      sort,
      track_total_hits: true
    },
    _source: { excludes, includes },
    from,
    size: pagination || 50
  })
  const { hits: { hits, total: { value: count } } } = searchResponse
  let results = hits.map(hit => hit._source)
  if (isPublic) {
    results = results.map(result => {
      if (result.s >= 5) {
        result.s = 9
      }
      return result
    })
  }
  return { results, count }
}, { validateMasterKey: true })

Parse.Cloud.define('booked-cubes', async () => {
  const keepAlive = '1m'
  const size = 5000
  // Sorting should be by _shard_doc or at least include _shard_doc
  const index = ['rheinkultur-cubes']
  const sort = [{ _shard_doc: 'desc' }]
  const query = { bool: { must: [{ term: { s: 5 } }] } }
  let searchAfter
  let pointInTimeId = (await client.openPointInTime({ index, keep_alive: keepAlive })).id
  const cubes = []
  while (true) {
    const { pit_id, hits: { hits } } = await client.search({
      body: {
        pit: {
          id: pointInTimeId,
          keep_alive: keepAlive
        },
        size,
        track_total_hits: false,
        query,
        sort,
        search_after: searchAfter
      },
      _source: { includes: ['objectId', 's', 'gp'] }
    })
    if (!hits?.length) { break }
    pointInTimeId = pit_id
    cubes.push(...hits.map(hit => hit._source))
    if (hits.length < size) { break }
    // search after has to provide value for each sort
    const lastHit = hits[hits.length - 1]
    searchAfter = lastHit.sort
  }
  return cubes
}, $adminOnly)

// Before is only defined if address is changing
const indexCube = async (cube, before) => {
  // overwrite or create the document
  const [{ _id: id, doc: body }] = INDEXES['rheinkultur-cubes'].datasetMap([cube])
  await client.index({ index: 'rheinkultur-cubes', id, body })

  if (!before) {
    return
  }

  // If updated and different, and none other exists check and remove before city
  // const beforeCity = before?.ort
  // const city = cube.get('ort')
  // if (beforeCity !== city) {
  //   if (beforeCity && !await $query('Cube').notEqualTo('objectId', cube.id).equalTo('ort', beforeCity).first({ useMasterKey: true })) {
  //     await client.delete({ index: 'rheinkultur-cities-autocomplete', id: beforeCity }).then(consola.success).catch(consola.error)
  //   }
  //   await client.index({ index: 'rheinkultur-cities-autocomplete', id: city, body: { city } }).then(consola.success)
  // }
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
  // const city = cube.get('ort')
  // if (!await $query('Cube').notEqualTo('objectId', cube.id).equalTo('ort', city).first({ useMasterKey: true })) {
  //   await client.delete({ index: 'rheinkultur-cities-autocomplete', id: city }).then(consola.success).catch(consola.error)
  // }
  const street = cube.get('str')
  if (!await $query('Cube').notEqualTo('objectId', cube.id).equalTo('str', street).first({ useMasterKey: true })) {
    await client.delete({ index: 'rheinkultur-streets-autocomplete', id: street }).then(consola.success).catch(consola.error)
  }
}

const indexTaskList = (taskList) => {
  const [{ _id: id, doc: body }] = INDEXES['rheinkultur-fieldwork'].datasetMap([taskList])
  return client.index({ index: 'rheinkultur-fieldwork', id, body })
}

const unindexTaskList = (taskList) => {
  return client.delete({ index: 'rheinkultur-fieldwork', id: taskList.id }).then(consola.success).catch(consola.error)
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
  unindexCube,
  indexTaskList,
  unindexTaskList
}
