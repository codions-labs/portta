import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const server = createServer((request, response) => {
  if (request.url === '/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end('event: ready\ndata: backend\n\n')
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok: true, service: 'backend', path: request.url }))
})

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key']
  if (typeof key !== 'string') return socket.destroy()
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  socket.on('data', () => socket.write(Buffer.from([0x81, 0x05, ...Buffer.from('ready')])))
})

server.listen(8080, '0.0.0.0')
