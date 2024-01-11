require('./run')(async () => {
  await $query('ScoutSubmission').notEqualTo('form.comments', null).equalTo('comments', null).eachBatch(async (submissions) => {
    for (const submission of submissions) {
      submission.set('comments', submission.get('form').comments)
      await submission.save(null, { useMasterKey: true })
      console.log(submission.get('form').comments)
    }
  }, { useMasterKey: true })
  console.log('done')
})
