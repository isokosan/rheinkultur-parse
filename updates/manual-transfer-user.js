// require('./run')(async (fromUserIds, toUserId) => {
//   for (const id of fromUserIds) {
//     const user = await $getOrFail(Parse.User, id)
//     user.set('isBanned', true).save(null, { useMasterKey: true, context: { clearSessions: true } })
//     // delete
//     await $query('CookieConsent').equalTo('user', user).destroyAll({ useMasterKey: true })

//     // move
//     // "scout"
//     for (const type of ['Scout', 'Control', 'Disassembly']) {
//       await $query(type + 'Submission').equalTo('scout', user).each(async (submission) => {
//         submission.set('user', $pointer(Parse.User, toUserId).save(null, { useMasterKey: true })
//         await submission.save(null, { useMasterKey: true })
//       }, { useMasterKey: true })
//     }
//     // createdBy
//     for (const className of ['CubePhoto', 'CreditNote', 'FileObject', 'Invoice' ]) {
//       await $query(className + 'Submission').equalTo('scout', user).each(async (submission) => {
//         submission.set('user', $pointer(Parse.User, toUserId).save(null, { useMasterKey: true })
//         await submission.save(null, { useMasterKey: true })
//       }, { useMasterKey: true })
//     }
//     // user
//     for (const className of ['Notification', 'Audit']) {
//       await $query(className).equalTo('user', user).each(async (audit) => {
//         audit.set('user', $pointer(Parse.User, toUserId).save(null, { useMasterKey: true })
//         await audit.save(null, { useMasterKey: true })
//       }, { useMasterKey: true })
//     }
//     await $query()
//   }
//     // scouts and managers
// })