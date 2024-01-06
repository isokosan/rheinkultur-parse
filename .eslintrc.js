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
    CUBE_LIMIT: true,
    DEVELOPMENT: true,
    PLAYGROUND: true,
    moment: true,
    sendMail: true,
    $cleanDict: true,
    $adminOnly: true,
    $internOrAdmin: true,
    $internBookingManager: true,
    $fieldworkManager: true,
    $today: true,
    $wawiStart: true,
    $cubeLimit: true,
    $parsify: true,
    $pointer: true,
    $attr: true,
    $geopoint: true,
    $cache: true,
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
    $parsePk: true,
    // global variables in memory
    $countries: true
  },
  // add your custom rules here
  rules: {
    camelcase: 'off',
    quotes: ['error', 'single'],
    semi: ['error', 'never'],
    'eol-last': ['error', 'always'],
    'comma-dangle': ['error', 'never'],
    indent: [2, 2],
    'rk-lint/enforce-parse-class-naming': 'error',
    'rk-lint/no-duplicate-parse-triggers': 'error',
    'rk-lint/cube-must-encode': 'warn'
  }
}
