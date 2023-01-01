module.exports = async (req, res) => {
  const services = ['redis', 'elastic', 'lex', 'email']
  const responses = await Promise.all(services.map(async service => ({ service, result: await require('./' + service).test() })))
  return res.send(responses.reduce((acc, { service, result }) => ({ ...acc, [service]: result }), {}))
}
