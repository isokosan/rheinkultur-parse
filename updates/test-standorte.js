const addressList = [
  'Altenderner Str  79/Körtingsweg Dortmund',
  'Altenderner Str. 37  quer Dortmund',
  'Altwickeder Hellweg/Gudrunplatz gg  Dortmund',
  'Am Remberg  23  Dortmund',
  'An der Goymark/Wellinghofer Str Dortmund',
  'Asselner Hellweg 167  Dortmund',
  'Berghofer Str. 167  Dortmund',
  'Bodelschwingher Str 198 Dortmund',
  'Bornstr. 41  / Si. Bornstr. Dortmund',
  'Borussiastr/Steinhammerstr 175  Dortmund',
  'Brackeler Hellweg 135a/Leni-Rommel-Str  Dortmund',
  'Brackeler Str. 51 Metro Einf. Dortmund',
  'Derner Str. 436 Dortmund',
  'Flughafenstr 549 parallel/Leveringstr Dortmund',
  'Germaniastr. 37 Rewe Nolte Einf.  Dortmund',
  'Hacheneyer Kirchweg   2 re/Massenezstr gg Dortmund',
  'Hamburger Str 97 li (L 663) Dortmund',
  'Hannöversche Str.  / Ri. (B 236) v. Brücke re.  Dortmund',
  'Harkortstr. 57a Dortmund',
  'Heimbrügge 5-7  Dortmund',
  'Hörder Phoenixseeallee 136 / Am Greenseel Dortmund',
  'Kaiserstr. 192  Dortmund',
  'Köln-Berliner-Str  42/Märtmannstr gg  Dortmund',
  'Kurler Str/Fohlenkamp gg SWH  Dortmund',
  'Lichtendorfer Str. 152  / Si. Eichholzstr.  Dortmund',
  'Lütgendortmunder Hellweg 15 RS  Dortmund',
  'Lütgendortmunder Hellweg 193/quer am Giebel (unten) Dortmund',
  'Preinstr/Zillestr östliche VS Dortmund',
  'Schneiderstr 113 re/Max-Brandes-Str gg  Dortmund',
  'Steinkühlerweg  88/Kattowitzstr nh  Dortmund',
  'Altendorfer Str 489 (B 231)/Hopfenstr Essen',
  'Am Zehnthof 236/Krayer Str  Essen',
  'Backwinkelstr   3/Kohlbergstr gg  Essen',
  'Bochumer Landstr. 312 Essen',
  'Bonifaciusstr 191/Kappertsiepen nh  Essen',
  'Bottroper Str Ufg ew li/Am Lichtbogen Nh  Essen',
  'Cathostr. / Bottroper Str. 331a Essen',
  'Dahlhauser Str 196 li/Von Ossietzky Ring  Essen',
  'Einigkeitstr   8/Alfredstr (B 224)/A 52 nh  Essen',
  'Eleonorastr  42 Essen',
  'Elisenstr  23 li  Essen',
  'Ernestinenstr   2/Essener Str nh  Essen',
  'Essener Str. 95 Essen',
  'Fontänengasse/Viehofer Str nh Essen',
  'Frintroper Str 593 (B 231)/Unterstr Essen',
  'Gelsenkirchener Str 162 Essen',
  'Gelsenkirchener Str 200 gg  Essen',
  'Gladbecker Str 257 (B 224)/In der Baumschule gg Essen',
  'Grenoblestr/Krayerstr gg  Essen',
  'Hallostr  14 gg/Roonstr Essen',
  'Hans-Böckler-Str.  / Hachestr.  Essen',
  'Heinitzstr   2/Sälzerstr  Essen',
  'Karnaper Str 142  Essen',
  'Kupferdreher Str  57/Hinsbecker Berg  Essen',
  'Langenberger Str 469/Rüpingsweg Essen',
  'Palmbuschweg   6  Essen',
  'Ruhrau 25  quer Essen',
  'Schalker Str. 5 Essen',
  'Stauderstr 205/Heibauerweg gg Essen',
  'Westfalenstr 299 li Essen',
  'Albrechtstr  28 Wuppertal',
  'Am Eckstein  / Wittener Str. 48 Wuppertal',
  'Bahnstr. 296/B 224/rts (quer vor Giebel)  Wuppertal',
  'Bockmühle 85  Wuppertal',
  'Briller Str 161/Bayreuther Str  Wuppertal',
  'Carnaper Str  89  Wuppertal',
  'Dahler Str  24 li (B 7) Wuppertal',
  'Elias-Eller-Str. 47  / Gärtnerstr. quer Wuppertal',
  'Friedrich-Engels-Allee 314/Erichstr 2 Wuppertal',
  'Gewerbeschulstr  30/Fischertal nh Wuppertal',
  'Kaiserstr  32/Rottscheidter Str Wuppertal',
  'Kleine Klotzbahn 37  / Grünstr. re. Wuppertal',
  'Märkische Str 125 re/Müggenkamp nh  Wuppertal',
  'Mauerstr. 14/Bendahler Str/Zuf. Kaufland -Elberfelder Str Wuppertal',
  'Uellendahler Str  63/Hamburgerstr nh  Wuppertal'
]

require('./run')(async () => {
  for (const query of addressList) {
    const data = await Parse.Cloud.run('nominatim-search', { query })
    if (!data.length) {
      console.log('Nicht gefunden')
      continue
    }
    // console log google map link with coords
    console.log(`https://www.google.com/maps/search/?api=1&query=${data[0].lat},${data[0].lon}`)
  }
})
