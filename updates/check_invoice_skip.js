async function checkLexOfficeSkip () {
  const year = 23
  const missing = { Invoice: [], CreditNote: [] }
  for (const [className, classPrefix] of [['Invoice', 'RE'], ['CreditNote', 'GS']]) {
    const prefix = classPrefix + year + '-'
    const nos = await $query(className)
      .notEqualTo('lexNo', null)
      .distinct('lexNo', { useMasterKey: true })
    let carry
    for (const no of nos) {
      if (!carry) { carry = parseInt(no.replace(prefix, '')) }
      const number = parseInt(no.replace(prefix, ''))
      if (number !== carry) {
        missing[className].push(carry)
        carry++
      }
      carry++
    }
  }
  consola.warn(missing)
}

require('./run')(checkLexOfficeSkip)
