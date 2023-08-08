const { fakerDE: faker } = require('@faker-js/faker')

async function createFakeObj (className, qty = 10, fakeFn, opts = {}) {
  const Obj = Parse.Object.extend(className)
  for (let i = 0; i < qty; i++) {
    opts.i = i
    const item = await fakeFn(opts)
    const obj = new Obj(item)
    await obj.save(null, { useMasterKey: true })
  }
}

async function runFakeFn (fnName, qty = 10, fakeFn, opts = {}) {
  for (let i = 0; i < qty; i++) {
    opts.i = i
    const data = await fakeFn(opts)
    if (!data) {
      continue
    }
    const { params, context } = data
    await Parse.Cloud.run(fnName, params, { useMasterKey: true, context })
  }
}

async function runWhileFn (fnName, fakeFn, opts = {}) {
  let i = 0
  while (true) {
    opts.i = i
    const data = await fakeFn(opts)
    if (!data) {
      return Promise.resolve()
    }
    const { params, context } = data
    await Parse.Cloud.run(fnName, params, { useMasterKey: true, context })
    i++
  }
}

module.exports = {
  faker,
  createFakeObj,
  runFakeFn,
  runWhileFn
}
