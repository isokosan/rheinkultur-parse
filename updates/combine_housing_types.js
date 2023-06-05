async function combineHousingTypes (from, to) {
  const htFrom = await $query('HousingType').equalTo('code', from).include('files').first({ useMasterKey: true })
  const htTo = await $query('HousingType').equalTo('code', to).include('files').first({ useMasterKey: true })
  if (!htFrom) { throw new Error('From housing type with code ' + from + ' not found') }
  if (!htTo) { throw new Error('To housing type with code ' + to + ' not found') }

  // firstly remove all the non-standard templates from the to HT, then replace with the to templates
  const { aluFrontFile, aluSideFile, foilFrontFile, foilSideFile } = htFrom.attributes
  const changes = $cleanDict($changes(htTo, { aluFrontFile, aluSideFile, foilFrontFile, foilSideFile }))
  if (changes) {
    htTo.set({ aluFrontFile, aluSideFile, foilFrontFile, foilSideFile })
    const audit = { fn: 'housing-type-update', data: { changes } }
    await htTo.save(null, { useMasterKey: true, context: { audit } })
    consola.success('Non-standard templates moved from ' + from + ' to ' + to)
  }

  // update all cubes to new housing type
  await $query('Cube').equalTo('ht', htFrom).each(async (cube) => {
    const changes = { htId: [cube.get('ht')?.id, htTo.id] }
    cube.set({ ht: htTo, media: htTo.get('media') })
    const audit = { fn: 'cube-update', data: { changes } }
    await $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
  }, { useMasterKey: true })
}

function combine () {
  return combineHousingTypes('MFG 18 Schroff V2', 'MFG 18 Schroff')
}

require('./run')(combine)
