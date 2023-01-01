const { google } = require('googleapis')
const { readFileSync } = require('fs')

const scopes = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive'
]

const auth = new google.auth.JWT(
  process.env.GOOGLE_APPLICATION_CLIENT_EMAIL,
  null,
  readFileSync('./.googlekey', 'utf-8'),
  scopes
)

const drive = google.drive({ version: 'v3', auth })
const docs = google.docs({ version: 'v1', auth })

module.exports = {
  drive,
  docs,
  test: async () => {
    const { data: { id } } = await drive.files.get({
      fileId: process.env.GOOGLE_ORIGIN_FILE_ID,
      fields: '*'
    })
    return id === process.env.GOOGLE_ORIGIN_FILE_ID
  }
}
