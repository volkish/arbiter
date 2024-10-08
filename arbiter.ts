import { copyFile, readFile, writeFile } from 'node:fs'
import path from 'node:path'
import fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyWebsocket, { type SocketStream } from '@fastify/websocket'
import Proxy from './arbiter-src/proxy'
import ProxyFactory from './arbiter-src/proxy-factory'
import TokenRegistry from './arbiter-src/token-registry'
import MobileProxySpace from './arbiter-src/mobile-proxy-space'
import LocalProxy from './arbiter-src/local-proxy'
import queue from './arbiter-src/queue'

const arbiterConfig = require(path.join(process.cwd(), 'proxies.json')) as {
  host: string,
  port: number,
  timeout?: number
  activeLimit?: number
  limit?: number
  list: Array<any>
}

let PROXY_TIMEOUT = arbiterConfig?.timeout ?? 2
let MAXIMUM_TOKENS_PER_RUN = arbiterConfig?.limit ?? 5
let MAXIMUM_ACTIVE_TOKENS = arbiterConfig?.activeLimit ?? 2

const proxies: Array<Proxy> = arbiterConfig
  .list
  .map(data => ProxyFactory.createFromJSON(data)) // Создаем Proxy объект
  .sort((p1, p2) => p1.connectionString.localeCompare(p2.connectionString))
  .sort((p1, p2) => p1.constructor.name.localeCompare(p2.constructor.name))

/**
 * Проверка модемов
 */
async function checkProxies () {
  const result = [], filteredProxies = proxies.filter(p => p.enabled && p.lastError && !p.restarting)

  for (const proxy of filteredProxies) {
    await proxy.restart()

    if (proxy.lastError) {
      result.push(proxy)
    }
  }

  broadcast()

  return result
}

/**
 * Сохраняем прокси в файл
 */
function saveProxies () {
  return new Promise((resolve, reject) => {
    const date = new Date()

    queue.add(() => {
      copyFile('./proxies.json', `./backup/proxies.${date.getFullYear()}-${date.getMonth()}-${date.getDate()}.json`, (err) => {
        if (!err) {
          const list = proxies
            .filter(proxy => proxy instanceof LocalProxy)
            .map(proxy => proxy.toJson())

          writeFile('./proxies.json', JSON.stringify({
            ...arbiterConfig,
            timeout: PROXY_TIMEOUT,
            activeLimit: MAXIMUM_ACTIVE_TOKENS,
            limit: MAXIMUM_TOKENS_PER_RUN,
            list,
          }), (_) => {
            if (!err) {
              broadcast()
              resolve(1)
            } else {
              reject(err)
            }
          })
        } else {
          reject(err)
        }
      })
    })
  })
}

const fastifyInstance = fastify({
  disableRequestLogging: true,
})

fastifyInstance.register(fastifyWebsocket)
fastifyInstance.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (connection: SocketStream, req: FastifyRequest) => {
    // Pass
  })
})

fastifyInstance.register(async (fastify) => {
  fastify.addHook('onResponse', (_, reply) => {
    reply.header('Cache-Control', 'no-store')
  })
})

function broadcast () {
  new Promise(r => {
    for (let client of fastifyInstance.websocketServer.clients) {
      client.send(JSON.stringify(
        presenters.list(proxies)
      ))
    }

    r(1)
  }).catch(() => void 0)
}

// region Api

fastifyInstance.get('/acquire', (
  request: FastifyRequest<{ Querystring: { timeout: string } }>,
  reply
) => {
  const timeout = Number(request.query.timeout || PROXY_TIMEOUT)

  return new Promise(resolve => {
    queue.add(() => {
      // Всегда берем самые старые прокси
      const sortedProxies = [
        ...proxies
          .sort((proxy1, proxy2) => proxy1.lastAccessTimestamp - proxy2.lastAccessTimestamp)
          .filter(proxy => proxy.available(MAXIMUM_TOKENS_PER_RUN, MAXIMUM_ACTIVE_TOKENS))
      ]

      for (const proxy of sortedProxies) {
        const token = proxy.acquire(MAXIMUM_TOKENS_PER_RUN, MAXIMUM_ACTIVE_TOKENS)

        if (token) {
          let timer: NodeJS.Timeout | undefined = setTimeout(
            () => {
              proxy.log(`[${token.id}] Таймут`)

              token.destroy()
            },
            timeout * 60000,
          )

          // Запоминает токен в регистре,
          // это нужно будет для того чтобы
          // его найти в дальнейшем для удаления
          TokenRegistry.set(token)

          // Когда токен удаляется, нужно удалить его из регистра
          token.once('destroy', () => {
            proxy.log(`[${token.id}] Удален`)

            TokenRegistry.delete(token)

            // Удаляем таймер
            if (timer) {
              clearTimeout(timer)
              timer = undefined
            }
          })

          proxy.log(`Выдал прокси на ${timeout} минут. Токен ${token.id}`)

          broadcast()

          resolve({
            ...proxy.dump(),
            token: token.id,
          })

          return
        }
      }

      reply.status(429)
      resolve({})
    })
  })
})

fastifyInstance.get('/release', async (request: FastifyRequest<{
  Querystring: { token: string }
}>, reply: FastifyReply<any>) => {
  const token = TokenRegistry.get(request.query.token)

  // Такого токена нет
  if (!token) {
    reply.status(404)

    return {
      notFound: request.query.token,
    }
  }

  token.destroy()

  broadcast()

  return {
    released: token.id,
  }
})

fastifyInstance.get('/check', async () => {
  return {
    errors: await checkProxies(),
  }
})

fastifyInstance.get('/list', async () => {
  return proxies
    .sort((p1, p2) => p1.connectionString.localeCompare(p2.connectionString))
    .sort((p1, p2) => p1.constructor.name.localeCompare(p2.constructor.name))
    .map(proxy => {
      return proxy.connectionString + ' [SOCKS5] [' + proxy.connectionString + ']'
    }).join('\n')
})

// endregion

// region Admin Panel

fastifyInstance.get('/', (_, res) => {
  return new Promise(resolve => {
    readFile(path.join(process.cwd(), 'admin', 'index.html'), (_, buffer) => {
      resolve(
        res.code(200)
          .type('text/html')
          .send(buffer)
      )
    })
  })
})

const presenters = {
  proxy (proxy: Proxy) {
    return {
      ...proxy, type: proxy.constructor.name,
    }
  },
  list (proxies: Array<Proxy>) {
    return {
      timeout: PROXY_TIMEOUT,
      limit: MAXIMUM_TOKENS_PER_RUN,
      activeLimit: MAXIMUM_ACTIVE_TOKENS,
      proxies: proxies.map(proxy => {
        return this.proxy(proxy)
      })
    }
  },
}

fastifyInstance.get('/api/balance/:id', async (req: FastifyRequest<{
  Params: { id: string }
}>, res) => {
  const proxy = proxies.find(p => p.id === Number(req.params.id))

  if (proxy) {
    return await proxy.getAccountBalance()
  }

  res.status(404)
  res.send({
    id: req.params.id,
  })
})

fastifyInstance.get('/api/proxies/:id', async (req: FastifyRequest<{
  Params: { id: string }
}>, res) => {
  const proxy = proxies.find(p => p.id === Number(req.params.id))

  if (proxy) {
    return presenters.proxy(proxy)
  }

  res.status(404)
  res.send({
    id: req.params.id,
  })
})

fastifyInstance.post('/api/limit', async (req: FastifyRequest<{
  Querystring: { limit: string }
}>) => {
  MAXIMUM_TOKENS_PER_RUN = Math.max(1, Math.min(parseInt(req.query.limit), 1000))

  await saveProxies()

  return {
    limit: MAXIMUM_TOKENS_PER_RUN,
  }
})

fastifyInstance.post('/api/timeout', async (req: FastifyRequest<{
  Querystring: { timeout: string }
}>) => {
  PROXY_TIMEOUT = Math.max(1, Math.min(parseInt(req.query.timeout), 60))

  await saveProxies()

  return {
    timeout: PROXY_TIMEOUT,
  }
})

fastifyInstance.post('/api/activeLimit', async (req: FastifyRequest<{
  Querystring: { limit: string }
}>) => {
  MAXIMUM_ACTIVE_TOKENS = Math.max(1, Math.min(parseInt(req.query.limit), 1000))

  await saveProxies()

  return {
    limit: MAXIMUM_ACTIVE_TOKENS,
  }
})

fastifyInstance.post('/api/proxies/:id', async (req: FastifyRequest<{
  Body: { [key: string]: any },
  Params: { id: string }
}>, res) => {
  const proxy = proxies.find(p => p.id === Number(req.params.id))

  if (!proxy) {
    res.status(404)

    return {
      id: req.params.id,
    }
  }

  await proxy.update(req.body)

  // Если прокси включили, то нужно проверить статус
  if (proxy.enabled) {
    // Если есть активные токены, то не инициализируем его.
    if (proxy.activeTokens === 0) {
      await proxy.initialize()
    }
  } else {
    proxy.disable()
  }

  await saveProxies()

  return presenters.proxy(proxy)
})

fastifyInstance.post('/api/proxies', async (req) => {
  const proxy = ProxyFactory.createFromJSON(req.body)

  // Подписываемся на уведомления от прокси
  proxy.on('log', (message) => {
    console.warn(message)
  })

  // Если добавляется включенным, то нужно проверить его статус
  if (proxy.enabled) {
    await proxy.initialize()
  }

  proxies.push(proxy)

  await saveProxies()

  return presenters.proxy(proxy)
})

fastifyInstance.get('/api/proxies', async () => {
  return presenters.list(proxies)
})

// endregion

async function getExternalProxies () {
  // Загружаем новый список
  const externalProxies = await MobileProxySpace.getList()

  externalProxies?.forEach(
    externalProxy => {
      console.log('[System] Внешний прокси:', externalProxy.proxy_id, ' адрес:', `${externalProxy.proxy_host_ip}:${externalProxy.proxy_socks5_port}`)

      proxies.push(new MobileProxySpace({
        proxyId: externalProxy.proxy_id,
        connectionString: `${externalProxy.proxy_host_ip}:${externalProxy.proxy_socks5_port}`,
        enabled: true,
      }))
    },
  )
}

// Run the server!
const start = async () => {
  console.log('[System] Загрузка списка внешних прокси…')

  // await getExternalProxies()

  console.log('[System] Проверка прокси…')

  for (const proxy of proxies) {
    proxy.on('log', (message) => {
      console.warn(message)
    })

    await proxy.initialize()
  }

  try {
    console.log('[System] Старт арбитра…')

    await fastifyInstance.listen({
      port: arbiterConfig.port,
      host: arbiterConfig.host,
    })

    fastifyInstance.server.on('error', function (err) {
      console.error('[System] ', err.message)
    })

    console.log('[System] Арбитр готов к работе')
    console.log('[System] ' + 'http' + '://' + arbiterConfig.host + ':' + arbiterConfig.port)

    setInterval(() => {
      console.log('[System] Запуск проверки мертвых прокси')

      checkProxies()
    }, 1000 * 5 * 60).unref()
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

start().then(_ => {})
