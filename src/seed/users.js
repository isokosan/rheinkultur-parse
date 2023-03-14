const { faker, createFakeObj } = require('./utils')
const fakeUser = async function ({ email, accType, permissions, firstName, lastName, mobile, pbx, companyId }) {
  email = email || faker.internet.email()
  return {
    username: email,
    email,
    password: '123456',
    firstName,
    lastName,
    accType,
    permissions,
    mobile,
    pbx,
    company: companyId
      ? await $getOrFail('Company', companyId)
      : undefined
  }
}

async function seed () {
  consola.info('seeding users')
  Promise.all([
    {
      email: 'denizar@gmail.com',
      prefix: 'Herr',
      firstName: 'Deniz',
      lastName: 'Genctürk',
      mobile: '0178-6561494',
      accType: 'admin'
    },
    {
      email: 'kwe@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Klaus Peter',
      lastName: 'Weber',
      mobile: '0151-40710083',
      pbx: 'Durchwahl: 11',
      accType: 'admin'
    },
    {
      email: 'rwe@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Robin',
      lastName: 'Weber',
      mobile: '0171-2896042',
      pbx: 'Durchwahl: 20',
      accType: 'admin'
    },
    {
      email: 'ast@rheinkultur-medien.de',
      prefix: 'Frau',
      firstName: 'Alina',
      lastName: 'Stromberg',
      title: 'Buchhaltung',
      mobile: '0152-34180164',
      pbx: 'Durchwahl: 22',
      accType: 'admin'
    },
    {
      email: 'giwe@rheinkultur-medien.de',
      prefix: 'Frau',
      firstName: 'Gina',
      lastName: 'Weber',
      mobile: '0160-99160220',
      pbx: 'Durchwahl: 32',
      accType: 'admin'
    },
    {
      email: 'jho@rheinkultur-medien.de',
      prefix: 'Frau',
      firstName: 'Jennifer',
      lastName: 'Horn',
      mobile: '0176-72128176',
      pbx: 'Durchwahl: 10',
      accType: 'intern'
    },
    {
      email: 'adv@rheinkultur-medien.de',
      prefix: 'Frau',
      firstName: 'Alessandra Di',
      lastName: 'Vincenzo',
      mobile: '0172-3001025',
      pbx: 'Durchwahl: 34',
      accType: 'intern'
    },
    {
      email: 'apa@rheinkultur-medien.de',
      prefix: 'Frau',
      firstName: 'Andrea',
      lastName: 'Palm',
      mobile: '0176-51321963',
      accType: 'intern'
    },
    {
      email: 'jso@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Jan',
      lastName: 'Sonnenberg',
      mobile: '0152-31857857',
      pbx: 'Durchwahl: 50',
      accType: 'intern'
    },
    {
      email: 'aqu@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Andreas',
      lastName: 'Quittmann',
      mobile: '0172-2005849',
      pbx: 'Durchwahl: 40',
      accType: 'intern'
    },
    {
      email: 'rko@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Richard',
      lastName: 'Kolbe',
      mobile: '0171-3667611',
      pbx: 'Durchwahl: 42',
      accType: 'intern'
    },
    {
      email: 'fsa@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Felice',
      lastName: 'Salerno',
      mobile: '0171-3167514',
      pbx: 'Durchwahl: 46',
      accType: 'intern'
    },
    {
      email: 'ptr@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Philipp',
      lastName: 'Triesch',
      mobile: '0176-32500997',
      accType: 'intern'
    },
    {
      email: 'sth@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Sasha',
      lastName: 'Thoms',
      accType: 'intern'
    },
    {
      email: 'jer@rheinkultur-medien.de',
      prefix: 'Herr',
      firstName: 'Jörg',
      lastName: 'Ernst',
      mobile: '0173-5313828',
      pbx: 'Durchwahl: 60',
      accType: 'intern'
    },
    {
      email: 'scout@rheinkultur-medien.de',
      firstName: 'Scout',
      lastName: 'Test',
      accType: 'scout'
    }
  ].map(opts => createFakeObj(Parse.User, 1, fakeUser, opts)))
  consola.success('seeded users')
}

module.exports = {
  seed,
  fakeUser
}
