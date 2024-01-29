const client = require('@/services/elastic')
const redis = require('@/services/redis')
const { EXCLUDE_CITIES_PER_PARTNER, errorFlagKeys } = require('@/cloud/cube-flags')

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
      settings: {
        analysis: {
          normalizer: {
            german_sort_normalizer: {
              type: 'custom',
              filter: ['lowercase', 'asciifolding']
            }
          }
        }
      },
      mappings: {
        properties: {
          geo: { type: 'geo_point' },
          str: {
            type: 'keyword',
            normalizer: 'german_sort_normalizer'
          },
          hsnr_numeric: { type: 'double' },
          ms: { type: 'boolean' }
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
        pk: cube.get('pk'),
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

        flags: cube.get('flags'),
        features: cube.get('features'),

        klsId: cube.get('importData')?.klsId,
        stovDate: cube.get('importData')?.date,
        ms: Boolean(cube.get('legacyScoutResults')),

        order: cube.get('order'),
        futureOrder: cube.get('futureOrder'),
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
          status: {
            type: 'scaled_float',
            scaling_factor: 10
          },
          archived: { type: 'boolean' },
          ort: { type: 'keyword' },
          stateId: { type: 'keyword' },
          date: {
            type: 'date',
            format: 'strict_date'
          },
          dueDate: {
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
        archived: !!taskList.get('archivedAt') || undefined,
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
          disassemblyFromRMV: booking.get('disassembly')?.fromRMV === true ? true : undefined,
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

async function countCubes (bool) {
  const { count } = await client.count({ index: 'rheinkultur-cubes', body: { query: { bool } } })
  return count
}

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
    flags,
    sm,
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
  // public can only search for '0' => available or '' => all
  if (isPublic) {
    s = s === 'all' ? '' : '0'
  }
  const isPartner = !master && user && user.get('accType') === 'partner' && user.get('company')
  // partner can only search for '0' => available, my_bookings or '' => all
  if (isPartner) {
    cId = user.get('company').id
    !['0', 'my_bookings', 'ml'].includes(s) && (s = '')
    if (s === 'my_bookings') {
      s = '6'
      orderClass = 'Booking'
    }
    lc = 'TLK'
  }

  s = s ? s.split(',').filter(Boolean) : []
  flags = flags ? flags.split(',').filter(Boolean) : []

  // normalize media/htId
  if (htId === 'KVZ' || htId === 'MFG') {
    media = htId
    htId = undefined
  }
  if (htId === 'htNM') {
    flags.push('htNM')
    htId = undefined
  }

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
    !sd && (sd = 'asc')
    // https://www.elastic.co/guide/en/elasticsearch/reference/current/sort-search-results.html#geo-sorting
    if (sb === 'objectId') {
      sort.unshift({ 'objectId.keyword': sd })
    }
    if (sb === 'hsnr') {
      sort.unshift({ 'hsnr.keyword': sd })
      sort.unshift({ hsnr_numeric: sd })
      sort.unshift({ str: sd })
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
  if (isPublic || isPartner) {
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
          // TOTEST: for public and partners lt should be 5
          { range: { s: { lt: isPublic || isPartner ? 5 : 6 } } },
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

  // SpecialFormat
  if (s.includes('4')) {
    bool.must.push({
      bool: {
        should: [
          { match: { 'order.className': 'SpecialFormat' } },
          { match: { 'futureOrder.className': 'SpecialFormat' } }
        ],
        minimum_should_match: 1
      }
    })
  }
  // FrameMount
  if (s.includes('5')) {
    bool.must.push({
      bool: {
        should: [
          { match: { 'order.className': 'FrameMount' } },
          { match: { 'futureOrder.className': 'FrameMount' } }
        ],
        minimum_should_match: 1
      }
    })
  }
  // Booked by contract or booking
  if (s.includes('6')) {
    const currentOrderMust = [{ exists: { field: 'order' } }]
    cId && currentOrderMust.push({ match: { 'order.company.objectId': cId } })
    orderClass && currentOrderMust.push({ match: { 'order.className': orderClass } })
    motive && currentOrderMust.push({ match_phrase_prefix: { 'order.motive': motive } })
    const futureOrderMust = [{ exists: { field: 'futureOrder' } }]
    cId && futureOrderMust.push({ match: { 'futureOrder.company.objectId': cId } })
    orderClass && futureOrderMust.push({ match: { 'futureOrder.className': orderClass } })
    motive && futureOrderMust.push({ match_phrase_prefix: { 'futureOrder.motive': motive } })
    bool.must.push({
      bool: {
        should: [
          { bool: { must: currentOrderMust } },
          { bool: { must: futureOrderMust } }
        ],
        minimum_should_match: 1
      }
    })
  }

  // Nicht vermarktungsfähig
  s.includes('7') && bool.must.push({ terms: { 'flags.keyword': errorFlagKeys } })
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
  s.includes('sM') && bool.must.push({ exists: { field: 'features' } })
  s.includes('sM-') && bool.must_not.push({ exists: { field: 'features' } })
  s.includes('ms') && bool.must.push({ term: { ms: true } })
  s.includes('nP') && bool.must_not.push({ exists: { field: 'pOk' } })
  s.includes('pOk') && bool.must.push({ exists: { field: 'pOk' } })
  s.includes('pMulti') && bool.must.push({ exists: { field: 'pMulti' } })

  for (const key of flags) {
    bool.must.push({ term: { 'flags.keyword': key } })
  }

  if (sm) {
    const features = {}
    for (const item of sm.split(',') || []) {
      const [key, value] = item.split(':')
      if (!features[key]) {
        features[key] = []
      }
      features[key].push(value)
    }
    for (const key of Object.keys(features)) {
      bool.must.push({ terms: { [`features.${key}`]: features[key] } })
    }
  }

  // address constraints
  if (pk) {
    [stateId, ort] = pk.split(':')
  }

  str && bool.filter.push({ term: { str } })
  hsnr && bool.filter.push({ match_phrase_prefix: { hsnr } })
  plz && bool.filter.push({ match_phrase_prefix: { plz } })
  ort && bool.filter.push({ term: { 'ort.keyword': ort } })
  stateId && bool.filter.push({ term: { 'state.objectId.keyword': stateId } })

  // TODO: only enable if coming from EXPORTS
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
      'vAt',
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
    if (isPartner) {
      includes.push('pk')
      includes.push('order.company.objectId')
      includes.push('futureOrder.company.objectId')
    }
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
  if (isPublic || isPartner) {
    results = results.map(result => {
      // show special-formats as available
      result.s === 4 && (result.s = 0)
      if (isPublic) {
        // make sure to change this in cube afterfind as well
        result.s >= 5 && (result.s = 7)
        return result
      }
      // show frame-mounts as "not available"
      result.s === 5 && (result.s = 6)
      // show as not available to partners if booked by other company
      const companyId = result.order?.company?.objectId || result.futureOrder?.company?.objectId
      if (result.s === 6 && companyId !== cId) {
        result.s = 7
      }
      if (!result.s && EXCLUDE_CITIES_PER_PARTNER[cId].includes(result.pk)) {
        result.s = 7
      }
      return result
    })
  }
  return { results, count }
}, { validateMasterKey: true })

// runs only on fieldwork list view
Parse.Cloud.define('search-fieldwork', async ({
  params: {
    c,
    state: stateId,
    type,
    start,
    end,
    managerId,
    scoutId,
    status,
    sa, // showArchived
    from,
    pagination
  }, user, master
}) => {
  status = status?.split(',').filter(Boolean).map(parseFloat)
  status.includes(4) && status.push(4.1)

  // BUILD QUERY
  const bool = { should: [], must: [], must_not: [], filter: [] }
  const sort = ['_score']
  if (user && user.get('accType') === 'partner') {
    managerId = user.id
    bool.must.push({ range: { status: { gte: 1 } } })
  }

  (start || end) && bool.filter.push({ range: { date: { gte: start, lte: end } } })

  stateId && bool.filter.push({ term: { stateId } })

  type && bool.filter.push({ term: { type } })

  // hideArchived
  !sa && bool.must_not.push({ term: { archived: true } })

  if (managerId) {
    managerId === 'none' && bool.must_not.push({ exists: { field: 'managerId' } })
    managerId === 'any' && bool.must.push({ exists: { field: 'managerId' } })
    managerId !== 'any' && managerId !== 'none' && bool.filter.push({ term: { 'managerId.keyword': managerId } })
  }

  if (scoutId) {
    scoutId === 'none' && bool.must_not.push({ exists: { field: 'scoutIds' } })
    scoutId === 'any' && bool.must.push({ exists: { field: 'scoutIds' } })
    scoutId !== 'any' && scoutId !== 'none' && bool.filter.push({ match: { 'scoutIds.keyword': scoutId } })
  }

  // hide drafts if not included in status filter explicity
  status?.length && bool.must.push({ terms: { status } })
  !status?.includes(0) && bool.must.push({ range: { status: { gt: 0 } } })

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
    sort.unshift({ ort: 'asc' })
    sort.unshift({ stateId: 'asc' })
    sort.unshift({ dueDate: 'asc' })
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
    disassemblyFromRMV,
    cubeId,
    str,
    hsnr,
    plz,
    ort,
    state: stateId,
    f,
    t,
    endFrom,
    endTo,
    sb,
    sd,
    from,
    pagination,
    returnQuery
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
    // partners cannot see draft bookings
    bool.must_not.push({ range: { status: { gte: 0, lte: 2 } } })
  }

  // booking
  no && bool.must.push({ wildcard: { 'no.keyword': `*${no.trim()}*` } })
  status ? bool.filter.push({ term: { status: parseFloat(status) } }) : bool.must_not.push({ term: { status: -1 } })
  companyId && bool.must.push({ match: { companyId } })
  motive && bool.must.push({ match_phrase_prefix: { motive } })
  externalOrderNo && bool.must.push({ match_phrase_prefix: { externalOrderNo } })
  autoExtends && bool.must.push({ term: { autoExtends: autoExtends === 'true' } })

  disassemblyFromRMV === 'true' && bool.must.push({ exists: { field: 'disassemblyFromRMV' } })
  disassemblyFromRMV === 'false' && bool.must_not.push({ exists: { field: 'disassemblyFromRMV' } })

  cubeId && bool.must.push({ wildcard: { 'cube.objectId.keyword': `*${cubeId}*` } })
  str && bool.filter.push({ term: { 'cube.str.keyword': str } })
  hsnr && bool.filter.push({ match_phrase_prefix: { 'cube.hsnr': hsnr } })
  plz && bool.filter.push({ match_phrase_prefix: { 'cube.plz': plz } })
  ort && bool.filter.push({ term: { 'cube.ort.keyword': ort } })
  stateId && bool.filter.push({ term: { 'cube.stateId.keyword': stateId } })

  endFrom && bool.must.push({ range: { endsAt: { gte: endFrom } } })
  endTo && bool.must.push({ range: { endsAt: { lte: endTo } } })

  if (returnQuery) {
    return {
      index: 'rheinkultur-bookings',
      query: { bool },
      sort
    }
  }

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
  status && bool.filter.push({ term: { status: parseFloat(status) } })

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
  const cached = await redis.get('cubes:everything')
  if (cached) { return JSON.parse(cached) }
  const keepAlive = '1m'
  const size = 5000
  // Sorting should be by _shard_doc or at least include _shard_doc
  const index = ['rheinkultur-cubes']
  const sort = [{ _shard_doc: 'desc' }]
  const query = { bool: { must_not: [{ terms: { s: [8, 9] } }] } }
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
      _source: { includes: ['gp', 's'] }
    })
    if (!hits?.length) { break }
    pointInTimeId = pit_id
    cubes.push(...hits.map(hit => hit._source))
    // cubes.push(...hits.map(hit => ({
    //   s: hit._source.s,
    //   lat: hit._source.gp.latitude,
    //   lon: hit._source.gp.longitude,
    //   id: hit._id
    // })))
    if (hits.length < size) { break }
    // search after has to provide value for each sort
    const lastHit = hits[hits.length - 1]
    searchAfter = lastHit.sort
  }
  await redis.set('cubes:everything', JSON.stringify(cubes))
  await redis.expire('cubes:everything', 86400) // TTL of 1 day
  return cubes
}, $adminOnly)

// Before is only defined if address is changing
const indexCubes = async (cubes) => {
  const dataset = INDEXES['rheinkultur-cubes'].datasetMap(cubes)
  consola.info('indexing:', dataset.length, 'cubes')
  if (!dataset.length) { return }
  return client.bulk({ refresh: true, body: dataset.flatMap(({ doc, _id }) => [{ index: { _index: 'rheinkultur-cubes', _id } }, doc]) })
}

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
  //     await client.delete({ index: 'rheinkultur-cities-autocomplete', id: beforeCity }).catch(consola.error)
  //   }
  //   await client.index({ index: 'rheinkultur-cities-autocomplete', id: city, body: { city } })
  // }
  const beforeStreet = before?.str
  const street = cube.get('str')
  if (beforeStreet !== street) {
    if (beforeStreet && !await $query('Cube').notEqualTo('objectId', cube.id).equalTo('str', beforeStreet).first({ useMasterKey: true })) {
      await client.delete({ index: 'rheinkultur-streets-autocomplete', id: beforeStreet }).catch(consola.error)
    }
    await client.index({ index: 'rheinkultur-streets-autocomplete', id: street, body: { street } })
  }
}

const unindexCube = async (cube) => {
  await client.delete({ index: 'rheinkultur-cubes', id: cube.id }).catch(consola.error)
  // const city = cube.get('ort')
  // if (!await $query('Cube').notEqualTo('objectId', cube.id).equalTo('ort', city).first({ useMasterKey: true })) {
  //   await client.delete({ index: 'rheinkultur-cities-autocomplete', id: city }).catch(consola.error)
  // }
  const street = cube.get('str')
  if (!await $query('Cube').notEqualTo('objectId', cube.id).equalTo('str', street).first({ useMasterKey: true })) {
    await client.delete({ index: 'rheinkultur-streets-autocomplete', id: street }).catch(consola.error)
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
  return client.delete({ index: 'rheinkultur-bookings', id: booking.id }).catch(consola.error)
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
  return client.delete({ index: 'rheinkultur-fieldwork', id: taskList.id }).catch(consola.error)
}

const purgeIndex = async function (index) {
  await client.indices.exists({ index }) && await client.indices.delete({ index })
  return `index deleted: ${index}`
}

const purgeIndexes = async function ({ params: { index: singleIndex } }) {
  if (singleIndex) {
    return purgeIndex(singleIndex)
  }
  const messages = []
  for (const index of Object.keys(INDEXES)) {
    messages.push(await purgeIndex(index))
  }
  return messages
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

async function deleteAndRecreateIndex (index, retries = 0) {
  if (await client.indices.exists({ index })) {
    const { acknowledged } = await client.indices.delete({ index })
    if (!acknowledged) {
      if (retries < 5) {
        retries++
        return deleteAndRecreateIndex(index, retries)
      }
      throw new Error('Delete response not acknowledged')
    }
  }
  try {
    const { acknowledged } = await client.indices.create({ index, body: INDEXES[index].config })
    if (!acknowledged && retries < 5) {
      retries++
      return deleteAndRecreateIndex(index, retries)
    }
    throw new Error('Create response not acknowledged')
  } catch (error) {
    if (error.statusCode === 400) {
      if (['process_cluster_event_timeout_exception', 'resource_already_exists_exception'].includes(error.body.error.type) && retries < 5) {
        retries++
        return deleteAndRecreateIndex(index, retries)
      }
      throw error
    }
  }
}

module.exports = {
  client,
  INDEXES,
  createOrUpdateIndex,
  deleteAndRecreateIndex,
  purgeIndex,
  purgeIndexes,
  indexCube,
  indexCubes,
  countCubes,
  unindexCube,
  indexCubeBookings,
  indexBooking,
  unindexBooking,
  indexBookingRequests,
  unindexBookingRequests,
  indexTaskList,
  unindexTaskList
}
