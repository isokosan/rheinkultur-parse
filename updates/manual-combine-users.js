async function combineUsers (fromUserIds, toUserId) {
  const toUser = await $getOrFail(Parse.User, toUserId)

  // make any changes to the toUser here if necessary
  for (const id of fromUserIds) {
    const user = await $getOrFail(Parse.User, id)
    await user.set('isBanned', true).save(null, { useMasterKey: true, context: { clearSessions: true } })
    // delete consents
    await $query('CookieConsent')
      .equalTo('user', user)
      .eachBatch(consents => Promise.all(consents.map(consent => consent.destroy({ useMasterKey: true }))), { useMasterKey: true })

    // move
    // "scout"
    for (const type of ['Scout', 'Control', 'Disassembly', 'Assembly']) {
      await $query(type + 'Submission').equalTo('scout', user).each(async (submission) => {
        await submission.set('scout', toUser).save(null, { useMasterKey: true })
        console.log(type, submission.id, 'submission scout changed')
      }, { useMasterKey: true })
    }
    // "createdBy"
    for (const className of ['CubePhoto', 'CreditNote', 'Comment', 'FileObject', 'Invoice']) {
      await $query(className).equalTo('createdBy', user).each(async (object) => {
        await object.set('createdBy', toUser).save(null, { useMasterKey: true })
        console.log(className, object.id, 'createdBy changed')
      }, { useMasterKey: true })
    }
    // "user"
    for (const className of ['Notification', 'Audit']) {
      await $query(className).equalTo('user', user).each(async (object) => {
        await object.set('user', toUser).save(null, { useMasterKey: true })
        console.log(className, object.id, 'user changed')
      }, { useMasterKey: true })
    }
    // scouts and manager
    await $query('TaskList').equalTo('scouts', user).each(async (object) => {
      const scouts = object.get('scouts')
      object.set('scouts', scouts.map(scout => scout.id === user.id ? toUser : scout))
      await object.save(null, { useMasterKey: true })
      console.log('scouts changed in tasklist', object.id)
    }, { useMasterKey: true })
    await $query('TaskList').equalTo('manager', user).each(async (object) => {
      await object.set('manager', toUser).save(null, { useMasterKey: true })
      console.log('manager changed in tasklist', object.id)
    }, { useMasterKey: true })

    // responsibles
    for (const className of ['Company', 'Booking', 'Contract', 'Briefing', 'Control']) {
      await $query(className).equalTo('responsibles', user).each(async (object) => {
        const responsibles = object.get('responsibles')
        object.set('responsibles', responsibles.map(res => res.id === user.id ? toUser : res))
        await object.save(null, { useMasterKey: true })
        console.log('responsibles changed in ', className, object.id)
      }, { useMasterKey: true })
    }
  }
}

require('./run')(() => combineUsers(['N9Q9EjMRjV', 'Uuk3gJOFBV'], 'SedO7eyKus'))
