import { createServer } from 'node:http'

createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><title>Taskflow PoC</title><h1>ready</h1>')
}).listen(3000, '0.0.0.0')
