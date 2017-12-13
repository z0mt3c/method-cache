// Load modules
const Boom = require('boom')
const Hoek = require('hoek')
const Catbox = require('catbox')
const CatboxMemory = require('catbox-memory')

// Declare internals
const internals = {
  methodNameRx: /^[_$a-zA-Z][$\w]*(?:\.[_$a-zA-Z][$\w]*)*$/
}

exports = module.exports = internals.Methods = class {
  constructor (options) {
    this.options = Object.assign({}, options)
    this.caches = new Map()
    this.methods = {}
    this.ready = this._initialize()
  }

  add (name, method, options) {
    if (typeof name !== 'object') {
      return this._add(name, method, options)
    }

    // {} or [{}, {}]
    const items = [].concat(name)
    for (let i = 0; i < items.length; ++i) {
      const item = Object.assign({ name: null, method: null, options: null }, items[i])
      this._add(item.name, item.method, item.options)
    }
  }

  _add (name, method, options) {
    Hoek.assert(typeof method === 'function', 'method must be a function')
    Hoek.assert(typeof name === 'string', 'name must be a string')
    Hoek.assert(name.match(internals.methodNameRx), 'Invalid name:', name)
    Hoek.assert(!Hoek.reach(this.methods, name, { functions: false }), 'Server method function name already exists:', name)

    options = Object.assign({ bind: null, method: null, options: null }, options)

    const settings = Hoek.cloneWithShallow(options, ['bind'])
    settings.generateKey = settings.generateKey || internals.generateKey

    const bind = settings.bind || null
    const bound = !bind ? method : (...args) => method.apply(bind, args)

        // Not cached

    if (!settings.cache) {
      return this._assign(name, bound)
    }

        // Cached

    Hoek.assert(!settings.cache.generateFunc, 'Cannot set generateFunc with method caching:', name)
    Hoek.assert(settings.cache.generateTimeout !== undefined, 'Method caching requires a timeout value in generateTimeout:', name)

    settings.cache.generateFunc = (id, flags) => bound(...id.args, flags)
    const cache = this._cachePolicy(settings.cache, '#' + name)

    const func = function (...args) {
      const key = settings.generateKey.apply(bind, args)
      if (typeof key !== 'string') {
        return Promise.reject(Boom.badImplementation('Invalid method key when invoking: ' + name, { name, args }))
      }

      return cache.get({ id: key, args })
    }

    func.cache = {
      drop: function (...args) {
        const key = settings.generateKey.apply(bind, args)
        if (typeof key !== 'string') {
          return Promise.reject(Boom.badImplementation('Invalid method key when invoking: ' + name, { name, args }))
        }

        return cache.drop(key)
      },
      stats: cache.stats
    }

    this._assign(name, func, func)
  }

  _assign (name, method) {
    const path = name.split('.')
    let ref = this.methods
    for (let i = 0; i < path.length; ++i) {
      if (!ref[path[i]]) {
        ref[path[i]] = (i + 1 === path.length ? method : {})
      }

      ref = ref[path[i]]
    }
  }

  _cachePolicy (options, _segment) {
    options = Object.assign({ cache: null, segment: null, shared: null }, options)

    const segment = options.segment || _segment
    Hoek.assert(segment, 'Missing cache segment name')

    const cacheName = options.cache || '_default'
    const cache = this.caches.get(cacheName)
    Hoek.assert(cache, 'Unknown cache', cacheName)
    Hoek.assert(!cache.segments[segment] || cache.shared || options.shared, 'Cannot provision the same cache segment more than once')
    cache.segments[segment] = true
    return new Catbox.Policy(options, cache.client, segment)
  }

  _initialize () {
    if (this.options) {
      this._createCache(this.options)
    }

    if (!this.caches.has('_default')) {
      this._createCache([{ engine: CatboxMemory }])
    }
    const init = []
    this.caches.forEach((cache) => init.push(cache.client.start()))
    return Promise.all(init)
  }

  _createCache (options) {
    Hoek.assert(this.phase !== 'initializing', 'Cannot provision server cache while server is initializing')
    const added = []
    for (let i = 0; i < options.length; ++i) {
      let config = options[i]
      if (typeof config === 'function') {
        config = { engine: config }
      }

      const name = config.name || '_default'
      Hoek.assert(!this.caches.has(name), 'Cannot configure the same cache more than once: ', name === '_default' ? 'default cache' : name)

      let client = null
      if (typeof config.engine === 'object') {
        client = new Catbox.Client(config.engine)
      } else {
        const settings = Hoek.clone(config)
        settings.partition = settings.partition || 'light-cache'
        delete settings.name
        delete settings.engine
        delete settings.shared

        client = new Catbox.Client(config.engine, settings)
      }

      this.caches.set(name, { client, segments: {}, shared: config.shared || false })
      added.push(client)
    }

    return added
  }
}

internals.generateKey = function (...args) {
  let key = ''
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i]
    if (typeof arg !== 'string' &&
            typeof arg !== 'number' &&
            typeof arg !== 'boolean') {
      return null
    }

    key = key + (i ? ':' : '') + encodeURIComponent(arg.toString())
  }

  return key
}
