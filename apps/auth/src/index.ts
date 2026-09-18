import { serve } from '@hono/node-server'
import { createAuthApp } from './app.ts'
import { loadAuthConfig, validateAuthConfig } from './config.ts'

const config = loadAuthConfig()
validateAuthConfig(config)

const version = process.env.PORTTA_RUNTIME_VERSION || 'unknown'

serve({ fetch: createAuthApp({ config }).fetch, hostname: config.host, port: config.port }, (info) => {
  process.stdout.write(`portta-auth ${version} listening on ${info.address}:${info.port}\n`)
})
