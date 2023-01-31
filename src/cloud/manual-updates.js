async function updateContractCampaignNos (dict) {
  let i = 0
  let s = 0
  for (const no of Object.keys(dict)) {
    const contract = await $query('Contract').equalTo('no', no).first({ useMasterKey: true })
    if (!contract) {
      throw new Error(`Contract ${no} not found`)
    }
    const campaignNo = dict[no]
    const changes = $changes(contract, { campaignNo })
    if (!Object.keys(changes).length) {
      s++
      continue
    }
    contract.set({ campaignNo })
    const audit = { fn: 'contract-update', data: { changes } }
    await contract.save(null, { useMasterKey: true, context: { audit, recalculatePlannedInvoices: true } })
    i++
  }
  consola.info('updated contract campaign nos', { s, i })
}

Parse.Cloud.define('manual-updates-contract-campaign-nos', ({ params: { dict } }) => {
  updateContractCampaignNos(dict)
  return 'ok'
}, { requireMaster: true })

async function updateContractExternalNos (dict) {
  let i = 0
  let s = 0
  for (const no of Object.keys(dict)) {
    const contract = await $query('Contract').equalTo('no', no).first({ useMasterKey: true })
    if (!contract) {
      throw new Error(`Contract ${no} not found`)
    }
    const externalOrderNo = dict[no]
    const changes = $changes(contract, { externalOrderNo })
    if (!Object.keys(changes).length) {
      s++
      continue
    }
    contract.set({ externalOrderNo })
    const audit = { fn: 'contract-update', data: { changes } }
    await contract.save(null, { useMasterKey: true, context: { audit, recalculatePlannedInvoices: true } })
    i++
  }
  consola.info('updated contract external nos', { s, i })
}

Parse.Cloud.define('manual-updates-contract-external-order-nos', ({ params: { dict } }) => {
  updateContractExternalNos(dict)
  return 'ok'
}, { requireMaster: true })

async function updateKinetic () {
  const kineticQuery = $query('Company').equalTo('name', 'Kinetic Germany GmbH')
  const shouldNotAutoExtend = [
    '20-0310', // ok
    '20-0311', // ok
    '20-0312', // ok
    '21-0447', // I added because it was already canceled
    '21-0648', // ok
    '21-0763', // ok
    '21-0764', // ok
    '21-0856', // to cancel
    '21-0897', // to cancel
    '21-0960', // ok
    '21-0970', // ok
    '22-0030', // ok
    '22-0031', // ok
    '22-0072', // to cancel
    '22-0076', // ok
    '22-0088' // to cancel
  ].map(no => 'V' + no)
  const query = Parse.Query.or(
    $query('Contract').equalTo('autoExtendsAt', null),
    $query('Contract').notEqualTo('noticePeriod', 6)
  )
    .matchesQuery('company', kineticQuery)
    .notContainedIn('no', shouldNotAutoExtend)
    .equalTo('canceledAt', null)
  let i = 0
  while (true) {
    const contract = await query.first({ useMasterKey: true })
    if (!contract) { break }
    const autoExtendsAt = moment(contract.get('endsAt')).subtract(6, 'months').format('YYYY-MM-DD')
    contract.set({
      autoExtendsAt,
      noticePeriod: 6
    })
    await contract.save(null, { useMasterKey: true, context: { setCubeStatuses: true } })
    i++
    consola.success('kinetic updated', contract.get('no'))
  }
  consola.success('DONE kinetic updates')
  return i
}

Parse.Cloud.define('manual-updates-kinetic', () => {
  updateKinetic()
  return 'ok'
}, { requireMaster: true })

Parse.Cloud.define('manual-updates-undo-cube-verify', async ({ params: { id } }) => {
  const cube = await $getOrFail('Cube', id)
  if (!cube.get('vAt')) {
    throw new Error('CityCube ist nicht verifiziert')
  }
  cube.set('vAt', null)
  const audit = { fn: 'cube-undo-verify' }
  return cube.save(null, { useMasterKey: true, context: { audit } })
}, { requireMaster: true })

Parse.Cloud.define('manual-updates-sg-housing-types', () => {
  const { seedSG } = require('@/seed/housing-types')
  seedSG()
  return 'OK'
}, { requireMaster: true })

const manualUpdates1000Sizes = async () => {
  while (true) {
    const cubePhotos = await $query('CubePhoto').equalTo('size1000', null).limit(10).find({ useMasterKey: true })
    if (!cubePhotos.length) { break }
    for (const cubePhoto of cubePhotos) {
      await cubePhoto.save(null, { useMasterKey: true })
      consola.info('generated size1000')
    }
  }
  consola.success('DONE')
}

Parse.Cloud.define('manual-updates-1000-sizes', () => {
  manualUpdates1000Sizes()
  return 'ok'
})
