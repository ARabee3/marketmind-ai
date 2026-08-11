import { createServer } from 'node:http'

const port = Number(process.env.E2E_SESSION_SERVER_PORT ?? 3101)

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(204).end()
    return
  }

  if (request.url === '/api/v1/auth/session' && request.method === 'GET') {
    const refreshToken = parseCookie(request.headers.cookie, 'refreshToken')
    const authorized = refreshToken?.startsWith('e2e-') === true
    if (!authorized) {
      response.writeHead(401).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ roles: ['OWNER'] }))
    return
  }

  response.writeHead(404).end()
})

server.listen(port, '127.0.0.1')

function parseCookie(header, name) {
  if (!header) return undefined

  for (const entry of header.split(';')) {
    const [key, ...value] = entry.trim().split('=')
    if (key === name) return value.join('=')
  }

  return undefined
}

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
