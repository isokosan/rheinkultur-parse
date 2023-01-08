const { faker } = require('./utils')
const { fetchPrintPackages } = require('@/cloud/classes/print-packages')

const PrintPackage = Parse.Object.extend('PrintPackage')

// sfk: 'Standard-Format KVZ & KVZ', // KVZ & MFG - Standard
// sadk: 'Alu Dibond KVZ', // KVZ - Alu
// padm: 'Alu Dibond MFG', // MFG - Alu
// phfk: 'HochleistungCityCube Premium Hochleistungs-Folie MFGs-Folie KVZ', // KVZ - Folie
// phfm: 'Hochleistungs-Folie MFG' // MFG - Folie
const PRINT_PACKAGES = [
  // Standard-Format (Sonderformat)
  { no: '1', type: 'std', price: 227, faces: { front: 1 } },
  { no: '2', type: 'std', price: 263, faces: { front: 1 } },
  { no: '3', type: 'std', price: 203, faces: { side: 1 } },
  { no: '4', type: 'std', price: 251, faces: { side: 2 } },
  { no: '5', type: 'std', price: 251, faces: { front: 1, side: 1 } },
  { no: '5.A', type: 'std', price: 305, faces: { front: 1, side: 2 } },
  { no: '6', type: 'std', price: 247, faces: { front: 1, side: 1 } },
  { no: '7', type: 'std', price: 203, faces: { side: 1 } },
  { no: '8', type: 'std', price: 247, faces: { side: 2 } },
  { no: '9', type: 'std', price: 227, faces: { front: 1 } },
  { no: '10', type: 'std', price: 277, faces: { front: 1, side: 1 } },
  { no: '11', type: 'std', price: 287, faces: { front: 1, side: 2 } },
  // CityCube Premium Hochleistungs-Folie MFG
  { no: '12', type: 'foil', media: 'MFG', price: 533, faces: { front: 1, side: 2 } },
  { no: '13', type: 'foil', media: 'MFG', price: 598, faces: { front: 1, side: 2, top: 1 } },
  { no: '13a', type: 'foil', media: 'MFG', price: 545, faces: { front: 1, side: 1, top: 1 } },
  { no: '13b', type: 'foil', media: 'MFG', price: 496, faces: { front: 1, top: 1 } },
  { no: '14', type: 'foil', media: 'MFG', price: 725, faces: { front: 1, side: 2, back: 1 } },
  { no: '14b', type: 'foil', media: 'MFG', price: 620, faces: { front: 1, back: 1 } },
  { no: '15', type: 'foil', media: 'MFG', price: 725, faces: { front: 1, side: 2, back: 1, top: 1 } },
  { no: '15a', type: 'foil', media: 'MFG', price: 710, faces: { front: 1, side: 1, top: 1, back: 1 } },
  { no: '15b', type: 'foil', media: 'MFG', price: 680, faces: { front: 1, back: 1, top: 1 } },
  { no: '16', type: 'foil', media: 'MFG', price: 440, faces: { front: 1 } },
  { no: '17', type: 'foil', media: 'MFG', price: 491, faces: { front: 1, side: 1 } },
  { no: '18', type: 'foil', media: 'MFG', price: 394, faces: { front: 1 } },
  { no: '19', type: 'foil', media: 'MFG', price: 337, faces: { side: 1 } },
  { no: '20', type: 'foil', media: 'MFG', price: 397, faces: { side: 2 } },
  // CityCube Premium Alu Dibond MFG
  { no: '29', type: 'alu', media: 'MFG', price: 464, faces: { front: 1, side: 2 } },
  { no: '30', type: 'alu', media: 'MFG', price: 647, faces: { front: 1, side: 2, back: 1 } },
  { no: '30a', type: 'alu', media: 'MFG', price: 630, faces: { front: 1, side: 1, back: 1 } },
  { no: '31', type: 'alu', media: 'MFG', price: 395, faces: { front: 1 } },
  { no: '32', type: 'alu', media: 'MFG', price: 437, faces: { front: 1, side: 1 } },
  { no: '33', type: 'alu', media: 'MFG', price: 367, faces: { front: 1 } },
  { no: '34', type: 'alu', media: 'MFG', price: 284, faces: { side: 1 } },
  { no: '35', type: 'alu', media: 'MFG', price: 334, faces: { side: 2 } },
  // CityCube Standard Alu Dibond KVZ
  { no: '36', type: 'alu', media: 'KVZ', price: 297, faces: { front: 1, side: 2 } },
  { no: '37', type: 'alu', media: 'KVZ', price: 364, faces: { front: 1, side: 2, back: 1 } },
  { no: '37a', type: 'alu', media: 'KVZ', price: 299, faces: { front: 1, side: 1, back: 1 } },
  { no: '38', type: 'alu', media: 'KVZ', price: 284, faces: { front: 1 } },
  { no: '39', type: 'alu', media: 'KVZ', price: 287, faces: { front: 1, side: 1 } },
  { no: '40', type: 'alu', media: 'KVZ', price: 244, faces: { side: 1 } },
  { no: '41', type: 'alu', media: 'KVZ', price: 264, faces: { side: 2 } },
  // ALDI
  { no: 'ALDI.1', type: 'alu', media: 'MFG', price: 249, faces: { front: 1 } },
  { no: 'ALDI.2', type: 'alu', media: 'MFG', price: 249, faces: { front: 1, side: 2 } },
  { no: 'ALDI.3', type: 'alu', media: 'KVZ', price: 249, faces: { front: 1, side: 1 } },
  { no: 'ALDI.4', type: 'alu', media: 'KVZ', price: 249, faces: { front: 1 } },
  { no: 'ALDI.5', type: 'alu', media: 'MFG', price: 249, faces: { front: 1 } },
  { no: 'ALDI.6', type: 'alu', media: 'KVZ', price: 249, faces: { front: 1, side: 2 } },
  { no: 'ALDI.7', type: 'alu', media: 'MFG', price: 319, faces: { front: 1, side: 2 } },
  { no: 'ALDI.8', type: 'alu', media: 'MFG', price: 319, faces: { front: 1 } },
  { no: 'ALDI.9', type: 'alu', media: 'MFG', price: 319, faces: { front: 1, side: 1 } }
]

const seed = async () => {
  if (await $query(PrintPackage).first({ useMasterKey: true })) {
    return
  }
  return Parse.Object.saveAll(PRINT_PACKAGES.map(item => new PrintPackage(item)), { useMasterKey: true })
}

let printPackagesList
const getRandomPrintPackage = async function (media) {
  if (!printPackagesList) {
    printPackagesList = await fetchPrintPackages()
  }
  return faker.helpers.arrayElement(printPackagesList.filter(pp => !pp.media || pp.media === media))
}

module.exports = {
  seed,
  getRandomPrintPackage
}
