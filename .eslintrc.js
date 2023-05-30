module.exports = {
  env: {
    commonjs: true,
    es2020: true,
    node: true
  },
  extends: ['eslint:recommended', 'standard'],
  parserOptions: {
    ecmaVersion: 11
  },
  plugins: [
    'rk-lint'
  ],
  globals: {
    Parse: true,
    consola: true,
    BASE_DIR: true,
    DEVELOPMENT: true,
    moment: true,
    sendMail: true,
    $cleanDict: true,
    $adminOnly: true,
    $internOrAdmin: true,
    $internBookingManager: true,
    $scoutManagerOrAdmin: true,
    $today: true,
    $wawiStart: true,
    $cubeLimit: true,
    $parsify: true,
    $pointer: true,
    $attr: true,
    $geopoint: true,
    $query: true,
    $getOrFail: true,
    $price: true,
    $notify: true,
    $audit: true,
    $deleteAudits: true,
    $changes: true,
    $cubeChanges: true,
    $states: true,
    $saveWithEncode: true,
    $pk: true,
    $bPLZ: true,
    $PDGA: true
  },
  // add your custom rules here
  rules: {
    camelcase: 'off',
    quotes: ['error', 'single'],
    semi: ['error', 'never'],
    'eol-last': ['error', 'always'],
    'comma-dangle': ['error', 'never'],
    indent: [2, 2],
    'rk-lint/cube-must-encode': 'warn'
  }
}
