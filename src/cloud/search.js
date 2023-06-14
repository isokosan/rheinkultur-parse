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
          geo: { type: 'geo_point' },
          hsnr_numeric: { type: 'double' }
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
        hsnr_numeric: isNaN(parseInt(cube.get('hsnr'))) ? undefined : parseInt(cube.get('hsnr')),
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
        pMulti: cube.get('legacyScoutResults')?.multipleImages && !cube.get('legacyScoutResults')?.multipleImagesFixed
          ? true
          : undefined,

        // warnings
        bPLZ: cube.get('bPLZ'),
        PDGA: cube.get('PDGA'),
        nMR: cube.get('nMR'),
        MBfD: cube.get('MBfD'),
        PG: cube.get('PG'),
        Agwb: cube.get('Agwb'),
        TTMR: cube.get('TTMR'),

        klsId: cube.get('importData')?.klsId,
        stovDate: cube.get('importData')?.date,
        order: cube.get('order'),
        pair: cube.get('pair'),

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
          status: { type: 'byte' },
          date: {
            type: 'date',
            format: 'strict_date'
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
        geo: taskList.get('gp')
          ? {
            lat: taskList.get('gp').latitude,
            lon: taskList.get('gp').longitude
          }
          : undefined,
        managerId: taskList.get('manager')?.id,
        scoutIds: taskList.get('scouts')?.map(scout => scout.id),
        date: taskList.get('date'),
        dueDate: taskList.get('dueDate')
      }
    }))
  },
  // bookings with cubes
  'rheinkultur-bookings': {
    config: {
      mappings: {
        properties: {
          status: { type: 'byte' },
          autoExtends: { type: 'boolean' },
          startsAt: {
            type: 'date',
            format: 'strict_date'
          },
          endsAt: {
            type: 'date',
            format: 'strict_date'
          }
        }
      }
    },
    parseQuery: $query('Booking'),
    datasetMap: bookings => bookings.map(booking => {
      const cube = booking.get('cube')
      return {
        _id: booking.id,
        doc: {
          bookingId: booking.id,
          no: booking.get('no'),
          status: booking.get('status'),
          motive: booking.get('motive'),
          externalOrderNo: booking.get('externalOrderNo'),
          companyId: booking.get('company').id,
          autoExtends: Boolean(booking.get('autoExtendsBy')),
          disassembly: booking.get('disassembly'),
          startsAt: booking.get('startsAt'),
          endsAt: booking.get('endsAt'),
          // responsibleIds: booking.get('responsibles')
          cube: {
            objectId: cube?.id,
            str: cube?.get('str'),
            hsnr: cube?.get('hsnr'),
            hsnr_numeric: isNaN(parseInt(cube?.get('hsnr'))) ? undefined : parseInt(cube.get('hsnr')),
            plz: cube?.get('plz'),
            ort: cube?.get('ort'),
            stateId: cube?.get('state')?.id
          }
        }
      }
    })
  },
  // Keep booking requests to a bare minimum of request info. The cube and booking information will not be searchable.
  'rheinkultur-booking-requests': {
    config: {
      mappings: {
        properties: {
          status: { type: 'byte' },
          updatedAt: { type: 'date' }
        }
      }
    },
    parseQuery: Parse.Query.or(
      $query('Booking').notEqualTo('request', null),
      $query('Booking').notEqualTo('requestHistory', null)
    ),
    datasetMap: bookings => bookings.map(booking => {
      return [booking.get('request'), booking.get('requestHistory') || []]
        .flat()
        .filter(Boolean)
        .map((request) => ({
          _id: request.id,
          doc: {
            bookingId: booking.id,
            no: booking.get('no'),
            cubeId: booking.get('cubeIds')[0],
            companyId: booking.get('company').id,
            ...request,
            status: request.status || 0
          }
        }))
    }).flat()
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
    motive,
    sb,
    sd,
    verifiable,
    availableFrom,
    isMap, // used to determine if query is coming from map and should only include limited fields
    from,
    pagination,
    returnQuery
  }, user, master
}) => {
  let orderClass
  const isPublic = !master && !user
  if (isPublic && s !== '0' && s !== '') {
    s = ''
  }
  const isPartner = !master && user && user.get('accType') === 'partner' && user.get('company')
  if (isPartner) {
    !['0', 'my_bookings', 'ml'].includes(s) && (s = '')
    if (s === 'my_bookings') {
      s = '5'
      orderClass = 'Booking'
      cId = user.get('company').id
    }
    lc = 'TLK'
  }

  s = s ? s.split(',').filter(Boolean) : []

  // BUILD QUERY
  const bool = { should: [], must: [], must_not: [], filter: [] }
  const sort = ['_score']
  id && bool.must.push({ wildcard: { 'objectId.keyword': `*${id}*` } })
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
    isMap && sort.unshift({
      _geo_distance: {
        geo: { lat, lon },
        order: 'asc',
        // unit : 'km', // default m
        mode: 'min',
        distance_type: 'plane', // How to compute the distance. Can either be arc (default), or plane (faster, but inaccurate on long distances and close to the poles).
        ignore_unmapped: true
      }
    })
  }

  if (!isMap) {
    // https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html#geo-sorting
    if (sb === 'objectId') {
      sort.unshift({ 'objectId.keyword': sd })
    }
    if (sb === 'hsnr') {
      sort.unshift({ 'hsnr.keyword': sd })
      sort.unshift({ hsnr_numeric: sd })
      sort.unshift({ 'str.keyword': sd })
      sort.unshift({ 'ort.keyword': sd })
      sort.unshift({ 'stateId.keyword': sd })
    }
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
  if (isPublic) {
    bool.must_not.push({ exists: { field: 'dAt' } })
    bool.must_not.push({ exists: { field: 'pair' } })
  }

  if (s.includes('0')) {
    const availableFromClause = availableFrom
      ? {
        bool: {
          should: [
            { bool: { must_not: { exists: { field: 'order.autoExtendsAt' } } } },
            { bool: { must: { exists: { field: 'order.canceledAt' } } } }
          ],
          must: { range: { 'order.endsAt': { lt: availableFrom } } }
        }
      }
      : null
    bool.must.push({
      bool: {
        should: [
          { bool: { must_not: { exists: { field: 's' } } } },
          { range: { s: { lt: 5 } } },
          availableFromClause
        ].filter(Boolean),
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
    orderClass && bool.must.push({ match: { 'order.className': orderClass } })
    motive && bool.must.push({ match_phrase_prefix: { 'order.motive': motive } })
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
  s.includes('8')
    ? bool.must.push({ exists: { field: 'dAt' } })
    : (!s.includes('all') && bool.must_not.push({ exists: { field: 'dAt' } }))
  s.includes('9')
    ? bool.must.push({ exists: { field: 'pair' } })
    : (!s.includes('all') && bool.must_not.push({ exists: { field: 'pair' } }))

  // single issues
  s.includes('sAt') && bool.must.push({ exists: { field: 'sAt' } })
  s.includes('vAt') && bool.must.push({ exists: { field: 'vAt' } })
  s.includes('nV') && bool.must_not.push({ exists: { field: 'vAt' } })
  s.includes('nP') && bool.must_not.push({ exists: { field: 'pOk' } })
  s.includes('pOk') && bool.must.push({ exists: { field: 'pOk' } })
  s.includes('pMulti') && bool.must.push({ exists: { field: 'pMulti' } })
  s.includes('TTMR') && bool.must.push({ exists: { field: 'TTMR' } })
  s.includes('bPLZ') && bool.must.push({ exists: { field: 'bPLZ' } })
  s.includes('PDGA') && bool.must.push({ exists: { field: 'PDGA' } })
  s.includes('nMR') && bool.must.push({ exists: { field: 'nMR' } })
  s.includes('MBfD') && bool.must.push({ exists: { field: 'MBfD' } })
  s.includes('PG') && bool.must.push({ exists: { field: 'PG' } })
  s.includes('Agwb') && bool.must.push({ exists: { field: 'Agwb' } })
  // s.includes('nStov') && bool.must_not.push({ match: { stovDate: '2023-04-21' } })

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

// runs only on fieldwork list view
Parse.Cloud.define('search-fieldwork', async ({
  params: {
    // pk, // placeKey (stateId:ort)
    c,
    state: stateId,
    type,
    start,
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
  if (user && user.get('accType') === 'partner') {
    managerId = user.id
    bool.must.push({ range: { status: { gt: 0 } } })
  }

  type && bool.filter.push({ term: { 'type.keyword': type } })

  if (start) {
    const gte = moment(start, 'MM-YYYY').startOf('month').format('YYYY-MM-DD')
    const lte = moment(start, 'MM-YYYY').endOf('month').format('YYYY-MM-DD')
    bool.filter.push({ range: { date: { gte, lte } } })
  }

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
  } else {
    sort.unshift({ date: { order: 'asc' } })
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
    if (!obj) {
      Parse.Cloud.run('triggerScheduledJob', { job: 'reindex_fieldwork' }, { useMasterKey: true })
      throw new Error('The search index is being re-synced, please try again in a minute.')
    }
    c && obj.set('distance', hit.sort[0])
    return obj.toJSON()
  })
  return { results, count }
}, { requireUser: true, validateMasterKey: true })

Parse.Cloud.define('search-bookings', async ({
  params: {
    no,
    motive,
    externalOrderNo,
    status,
    companyId,
    autoExtends,
    disassembly,
    cubeId,
    str,
    hsnr,
    plz,
    ort,
    state: stateId,
    f,
    t,
    sb,
    sd,
    from,
    pagination
  }, user, master
}) => {
  // BUILD QUERY
  const bool = { should: [], must: [], must_not: [], filter: [] }
  const sort = ['_score']
  if (sb === 'no') {
    sort.unshift({ 'no.keyword': sd })
  }
  if (user?.get('accType') === 'partner' && user.get('company')) {
    companyId = user.get('company').id
  }

  // booking
  no && bool.must.push({ wildcard: { 'no.keyword': `*${no}*` } })
  status ? bool.filter.push({ term: { status: parseInt(status) } }) : bool.must_not.push({ term: { status: -1 } })
  companyId && bool.must.push({ match: { companyId } })
  motive && bool.must.push({ match_phrase_prefix: { motive } })
  externalOrderNo && bool.must.push({ match_phrase_prefix: { externalOrderNo } })
  autoExtends && bool.must.push({ term: { autoExtends: autoExtends === 'true' } })
  disassembly && bool.must.push({ exists: { field: 'disassembly' } })

  cubeId && bool.must.push({ wildcard: { 'cube.objectId.keyword': `*${cubeId}*` } })
  str && bool.filter.push({ term: { 'cube.str.keyword': str } })
  hsnr && bool.filter.push({ match_phrase_prefix: { 'cube.hsnr': hsnr } })
  plz && bool.filter.push({ match_phrase_prefix: { 'cube.plz': plz } })
  ort && bool.filter.push({ term: { 'cube.ort.keyword': ort } })
  stateId && bool.filter.push({ term: { 'cube.stateId.keyword': stateId } })

  t && bool.must.push({ range: { startsAt: { lte: t } } })
  f && bool.must.push({ range: { endsAt: { gt: f } } })
  const searchResponse = await client.search({
    index: 'rheinkultur-bookings',
    body: {
      query: { bool },
      sort,
      track_total_hits: true
    },
    from,
    size: pagination || 50
  })
  const { hits: { hits, total: { value: count } } } = searchResponse
  const bookingIds = [...new Set(hits.map(hit => hit._source.bookingId))]
  const bookings = await $query('Booking')
    .containedIn('objectId', bookingIds)
    .include('deleted')
    .limit(bookingIds.length)
    .find({ useMasterKey: true })
  const results = hits.map(hit => {
    const booking = bookings.find(obj => obj.id === hit._source.bookingId)
    if (!booking) { return null }
    return booking.toJSON()
  }).filter(Boolean)
  return { results, count }
}, { requireUser: true, validateMasterKey: true })

// runs only on booking-requests list view
Parse.Cloud.define('search-booking-requests', async ({
  params: {
    requestId,
    cubeId,
    no,
    companyId,
    type,
    status,
    from,
    pagination
  }, user, master
}) => {
  // BUILD QUERY
  const bool = { should: [], must: [], must_not: [], filter: [] }
  const sort = ['_score']
  sort.unshift({ updatedAt: { order: 'desc' } })
  if (user && user.get('accType') === 'partner') {
    companyId = user.get('company').id
  }
  requestId && bool.filter.push({ term: { _id: requestId } })
  cubeId && bool.must.push({ wildcard: { 'cubeId.keyword': `*${cubeId}*` } })
  no && bool.must.push({ wildcard: { 'no.keyword': `*${no}*` } })
  companyId && bool.filter.push({ term: { 'companyId.keyword': companyId } })
  type && bool.filter.push({ term: { 'type.keyword': type } })
  status && bool.filter.push({ term: { status: parseInt(status) } })

  const searchResponse = await client.search({
    index: 'rheinkultur-booking-requests',
    body: {
      query: { bool },
      sort,
      track_total_hits: true
    },
    from,
    size: pagination || 50
  })
  const { hits: { hits, total: { value: count } } } = searchResponse
  const bookingIds = [...new Set(hits.map(hit => hit._source.bookingId))]
  const bookings = await $query('Booking')
    .containedIn('objectId', bookingIds)
    .include('deleted')
    .limit(bookingIds.length)
    .find({ useMasterKey: true })
  const results = hits.map(hit => {
    const booking = bookings.find(obj => obj.id === hit._source.bookingId)
    if (!booking) { return null }
    hit._source.booking = booking.toJSON()
    return hit._source
  }).filter(Boolean)
  return { results, count }
}, { requireUser: true, validateMasterKey: true })

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

const indexCubeBookings = async (cube) => {
  return $query('Booking').equalTo('cube', cube).each(indexBooking, { useMasterKey: true })
}

const indexBooking = async (booking) => {
  if (booking.get('cube') && !booking.get('cube')?.get?.('str')) {
    await booking.get('cube').fetch({ useMasterKey: true })
  }
  const [{ _id: id, doc: body }] = INDEXES['rheinkultur-bookings'].datasetMap([booking])
  return client.index({ index: 'rheinkultur-bookings', id, body })
}

const unindexBooking = (booking) => {
  return client.delete({ index: 'rheinkultur-bookings', id: booking.id }).then(consola.success).catch(consola.error)
}

const unindexBookingRequests = (booking) => {
  return client.deleteByQuery({
    index: 'rheinkultur-booking-requests',
    body: {
      query: {
        term: {
          'bookingId.keyword': booking.id
        }
      }
    }
  }).catch(consola.error)
}

const indexBookingRequests = async (booking) => {
  await unindexBookingRequests(booking)
  const dataset = INDEXES['rheinkultur-booking-requests'].datasetMap([booking])
  if (!dataset.length) { return }
  return client.bulk({ refresh: true, body: dataset.flatMap(({ doc, _id }) => [{ index: { _index: 'rheinkultur-booking-requests', _id } }, doc]) })
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

async function createOrUpdateIndex (index) {
  const { config } = INDEXES[index]
  // NOTE: If you run into resource_exists issues, delete the docker containers etc with "docker system prune"
  if (await client.indices.exists({ index })) {
    // close, update and then open the index if exists
    await client.indices.close({ index })
    config.settings && await client.indices.putSettings({ index, body: config.settings })
    config.mappings && await client.indices.putMapping({ index, body: config.mappings })
    await client.indices.open({ index })
    return client.indices.refresh({ index })
  }
  // create with new settings if does not exist
  return client.indices.create({ index, body: INDEXES[index].config })
}

module.exports = {
  client,
  INDEXES,
  createOrUpdateIndex,
  purgeIndexes,
  indexCube,
  unindexCube,
  indexCubeBookings,
  indexBooking,
  unindexBooking,
  indexBookingRequests,
  unindexBookingRequests,
  indexTaskList,
  unindexTaskList
}
