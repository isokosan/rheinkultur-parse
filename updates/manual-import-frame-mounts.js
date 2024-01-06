require('./run')(async () => {
  // Create Town Talker if does not exist
  const name = 'TownTalker Media AG'
  let company = await $query('Company').equalTo('name', name).first({ useMasterKey: true })
  !company && (company = await new Parse.Object('Company').save({ name }, { useMasterKey: true }))
  await $query('FrameMount')
    .each(async (frameMount) => {
      await frameMount
        .set('cubeIds', [])
        .set('status', 0)
        .save(null, { useMasterKey: true, context: { setCubeStatuses: true } })
      console.log(frameMount.get('no'), 'destroyed')
      await frameMount.destroy({ useMasterKey: true })
    }, { useMasterKey: true })
  console.log('all deleted!')

  const cubeIds = await $query('Cube').equalTo('flags', 'TTMR').distinct('objectId', { useMasterKey: true })

  const frameMount = new Parse.Object('FrameMount')
  frameMount.set({
    company,
    cubeIds,
    status: 3,
    // campaignNo,
    // externalOrderNo: data.Auftragsnummer,
    startsAt: '2023-01-01',
    endsAt: moment('2023-01-01').add(5, 'years').subtract(1, 'day').format('YYYY-MM-DD'),
    initialDuration: 60,
    autoExtendsBy: 12
  })
  await frameMount.save(null, { useMasterKey: true, context: { setCubeStatuses: true } })
  console.log('created', frameMount.get('no'))
})
