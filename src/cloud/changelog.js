const { readFile } = require('fs').promises

Parse.Cloud.define('changelog', () => {
  return readFile('./CHANGELOG.md').then(data => data.toString())
}, $adminOrMaster)
