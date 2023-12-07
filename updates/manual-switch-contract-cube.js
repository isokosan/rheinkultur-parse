async function switchCube (contractNo, fromId, toId) {
  const contract = await $query('Contract').equalTo('no', contractNo).first({ useMasterKey: true })
  const toCube = await $getOrFail('Cube', toId)
  if (!contract) { throw new Error('Contract not found') }
  const cubeIds = contract.get('cubeIds')
  if (cubeIds.includes(fromId) && !cubeIds.includes(toId)) {
    console.log(`Switching cube ${fromId} to ${toId}`)
    const index = cubeIds.indexOf(fromId)
    cubeIds[index] = toId
    contract.set({ cubeIds })
  }
  const monthlyMedia = contract.get('monthlyMedia')
  if (monthlyMedia && monthlyMedia[fromId] && !monthlyMedia[toId]) {
    console.log(`Switching cube ${fromId} to ${toId} monthlyMedia`)
    monthlyMedia[toId] = monthlyMedia[fromId]
    delete monthlyMedia[fromId]
    contract.set({ monthlyMedia })
  }
  const cubeData = contract.get('cubeData')
  if (cubeData && cubeData[fromId] && !cubeData[toId]) {
    console.log(`Switching cube ${fromId} to ${toId} cubeData`)
    delete cubeData[fromId]
    cubeData[toId] = {
      hsnr: toCube.get('hsnr'),
      str: toCube.get('str'),
      plz: toCube.get('plz'),
      ort: toCube.get('ort'),
      stateId: toCube.get('state').id,
      media: toCube.get('media'),
      htId: toCube.get('ht')?.id
    }
  }
  await contract.save(null, { useMasterKey: true, context: { setCubeStatuses: true, recalculatePlannedInvoices: true } })

  const production = await $query('Production').equalTo('contract', contract).first({ useMasterKey: true })
  if (production) {
    // remove cubes that are not in booking/contract from dictionaries
    for (const key of [
      'printPackages',
      'prices',
      'extras',
      'totals',
      'monthlies',
      'printTemplates',
      'printFiles',
      'printNotes'
    ]) {
      const obj = production.get(key) || {}
      if (obj && obj[fromId] && !obj[toId]) {
        console.log(`Switching cube ${fromId} to ${toId} ${key}`)
        obj[toId] = obj[fromId]
        delete obj[fromId]
        production.set(key, obj)
      }
    }
    await production.save(null, { useMasterKey: true })
  }

  const comment = `Der falsch angelegte CityCube ${fromId} wurde durch CityCube ${toId} ersetzt.`
  await Parse.Cloud.run('comment-create', {
    itemId: contract.id,
    itemClass: 'Contract',
    text: comment
  }, { useMasterKey: true })

  console.log(comment)
}

require('./run')(() => switchCube('V20-0761', 'TLK-72223A88', 'TLK-72223V1023'))
