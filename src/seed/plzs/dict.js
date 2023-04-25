module.exports = () => {
  const dict = {}
  for (const { plz, bundesland, ort } of require('./plzs.json')) {
    dict[plz] = { bundesland, ort }
  }
  return dict
}
