// const nos = [
//   'V22-0166',
//   'V22-0217',
//   'V22-0494',
//   'V22-0016',
//   'V19-0062',
//   'V22-0632',
//   'V21-0163',
//   'V22-0086',
//   'V21-0810',
//   'V18-0045',
//   'V22-0887',
//   'V21-0479',
//   'V22-0090',
//   'V21-0853',
//   'V22-0032',
//   'V21-0632',
// ]

require('./run')(async () => {
  let i = 0
  await $query('Comment')
    .equalTo('itemClass', 'Contract')
    .contains('text', 'hängen')
    .eachBatch(async (results) => {
      for (const comment of results) {
        const contract = await $getOrFail('Contract', comment.get('itemId')).catch(console.error)
        if (!contract) {
          console.log(comment.get('itemId'))
          continue
        }
        console.log(contract.get('no'))
        i++
      }
    }, { useMasterKey: true })
  console.log(i)
})
