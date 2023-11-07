const jwt = require('jsonwebtoken')
const ApiToken = Parse.Object.extend('ApiToken')

Parse.Cloud.beforeSave(ApiToken, ({ object: apiToken, user }) => {
  const company = apiToken.get('company') || user?.get('company')
  if (!company) {
    throw new Error('Company is required.')
  }
  if (apiToken.isNew()) {
    const token = jwt.sign({ companyId: company.id }, process.env.MASTER_KEY)
    apiToken.set('token', token)
  }
})
