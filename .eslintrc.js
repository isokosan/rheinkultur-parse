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
  globals: {
    Parse: true,
    consola: true,
    BASE_DIR: true,
    DEVELOPMENT: true,
    moment: true,
    sendMail: true,
    $adminOrMaster: true,
    $today: true,
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
    $cubeChanges: true
  },
  // add your custom rules here
  rules: {
    camelcase: 'off',
    quotes: ['error', 'single'],
    semi: ['error', 'never'],
    'eol-last': ['error', 'always'],
    'comma-dangle': ['error', 'never'],
    indent: [2, 2]
  }
}
