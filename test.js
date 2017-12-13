const Lab = require('lab')
const lab = exports.lab = Lab.script()
const { expect } = require('code')
const Cache = require('./')

function timeout (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

lab.test('test', async () => {
  const methodCache = new Cache()

  methodCache.add({
    name: 'test',
    method: (a) => {
      const random = Math.random()
      return `${a} ${random}`
    },
    options: {
      cache: {
        expiresIn: 500,
        generateTimeout: 200
      }
    }
  })

  await methodCache.ready
  const result = await methodCache.methods.test('foo')
  expect(await methodCache.methods.test('foo')).to.equal(result)
  await timeout(300)
  expect(await methodCache.methods.test('foo')).to.equal(result)
  await timeout(250)
  expect(await methodCache.methods.test('foo')).to.not.equal(result)
})
