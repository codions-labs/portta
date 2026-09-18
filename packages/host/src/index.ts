// What the CLI composes. The daemon itself starts from `bin.ts`.

export { createHostApp, HOST_PUBLIC_ROUTES, type HostAppOptions } from './app.ts'
export { bearerToken, tokenMatches } from './auth.ts'
export { DEFAULT_HOST_BIND, DEFAULT_HOST_PORT, type HostListen, hostListen } from './config.ts'
export { createHostUpgrade, type RunningHost, type StartHostOptions, startHost } from './main.ts'
export { HOST_MODULES, type HostContext, type HostModule, type HostWsRoute } from './modules/index.ts'
export { HOST_STATE_DIR, hostStateDir, hostTokenFile, readOrCreateToken, resolveHostStateDir } from './token.ts'
