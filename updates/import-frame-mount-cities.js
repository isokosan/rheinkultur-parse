// ([^\d]*\s*[^\d]+) .* ([^\d]*\s*[^\d]+) \d (.*)\n
// { ort: '$1', state: '$2', planned: $3 },\n

const list = [
  { ort: 'Karlsruhe', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Heilbronn', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Mannheim ', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Freiburg ', state: 'Baden-Württemberg', planned: 300 },
  { ort: 'Baden Baden', state: 'Baden-Württemberg', planned: 100 },
  { ort: 'Böblingen', state: 'Baden-Württemberg', planned: null },
  { ort: 'Esslingen', state: 'Baden-Württemberg', planned: null },
  { ort: 'Heidelberg ', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Leonberg ', state: 'Baden-Württemberg', planned: null },
  { ort: 'Ludwigsburg', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Pforzheim', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Reutlingen ', state: 'Baden-Württemberg', planned: 150 },
  { ort: 'Sindelfingen ', state: 'Baden-Württemberg', planned: null },
  { ort: 'Tübingen ', state: 'Baden-Württemberg', planned: 200 },
  { ort: 'Ulm', state: 'Baden-Württemberg', planned: null },
  { ort: 'Bodensee-Netz', state: 'Baden-Württemberg', planned: null },
  { ort: 'Stuttgart', state: 'Baden-Württemberg', planned: 250 },
  { ort: 'Augsburg ', state: 'Bayern ', planned: 100 },
  { ort: 'Bayreuth ', state: 'Bayern ', planned: null },
  { ort: 'Ingolstadt ', state: 'Bayern ', planned: 50 },
  { ort: 'Passau ', state: 'Bayern ', planned: null },
  { ort: 'Marburg', state: 'Hessen ', planned: null },
  { ort: 'Wiesbaden', state: 'Hessen ', planned: 150 },
  { ort: 'Braunschweig ', state: 'Niedersachsen', planned: 200 },
  { ort: 'Oldenburg', state: 'Niedersachsen', planned: 50 },
  { ort: 'Dortmund ', state: 'Nordrhein-Westfalen', planned: 250 },
  { ort: 'Düsseldorf ', state: 'Nordrhein-Westfalen', planned: 300 },
  { ort: 'Mülheim a.d. Ruhr', state: 'Nordrhein-Westfalen', planned: 100 },
  { ort: 'Bonn ', state: 'Nordrhein-Westfalen', planned: 200 },
  { ort: 'Bottrop', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Gütersloh', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Recklinghausen ', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Münster', state: 'Nordrhein-Westfalen', planned: 250 },
  { ort: 'Bielefeld', state: 'Nordrhein-Westfalen', planned: 150 },
  { ort: 'Hamm ', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Paderborn', state: 'Nordrhein-Westfalen', planned: 50 },
  { ort: 'Ludwigshafen ', state: 'Rheinland-Pfalz', planned: 50 },
  { ort: 'Kaiserslautern ', state: 'Rheinland-Pfalz', planned: null },
  { ort: 'Koblenz', state: 'Rheinland-Pfalz', planned: 100 },
  { ort: 'Trier', state: 'Rheinland-Pfalz', planned: 100 },
  { ort: 'Chemnitz ', state: 'Sachsen', planned: 150 },
  { ort: 'Dresden', state: 'Sachsen', planned: 200 },
  { ort: 'Leipzig', state: 'Sachsen', planned: 250 },
  { ort: 'Halle (Saale)', state: 'Sachsen-Anhalt ', planned: 100 },
  { ort: 'Magdeburg', state: 'Sachsen-Anhalt ', planned: 150 },
  { ort: 'Flensburg', state: 'Schleswig-Holstein ', planned: null },
  { ort: 'Lüneburg ', state: 'Schleswig-Holstein ', planned: null }
].filter((city) => city.planned !== null).map((city) => {
  city.ort = city.ort.trim()
  return city
})

require('./run')(async () => {
  // check if Stadtkultur GmbH has a test user
  const stadtkultur = await $getOrFail('Company', '19me3Ge8LZ')
  const user = await $query(Parse.User).equalTo('company', stadtkultur).first({ useMasterKey: true })
  if (!user) {
    await Parse.Cloud.run('user-invite', {
      email: 'test@stadtkultur-online.de',
      firstName: 'Stadkultur',
      lastName: '1',
      accType: 'partner',
      permissions: ['manage-frames'],
      companyId: '19me3Ge8LZ',
      password: '123456'
    }, { useMasterKey: true })
  }
  console.log(list)
})
