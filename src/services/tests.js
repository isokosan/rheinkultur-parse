module.exports = async (req, res) => {
  const services = ['redis', 'elastic', 'lex', 'email', 'googleapis', 'google-maps']
  const responses = await Promise.all(services.map(async service => {
    const response = { service }
    try {
      response.success = await require('./' + service).test()
    } catch (error) {
      response.error = error.message
    }
    return response
  }))
  return res.send(responses)
}
