async function undoVerify (cubeId) {
  const cube = await $getOrFail('Cube', cubeId)
  if (!cube.get('vAt')) { throw new Error('CityCube ist nicht verifiziert.') }
  cube.set('vAt', null)
  const audit = { fn: 'cube-undo-verify' }
  return $saveWithEncode(cube, null, { useMasterKey: true, context: { audit } })
}

require('./run')(() => undoVerify('TLK-71617A39'))
