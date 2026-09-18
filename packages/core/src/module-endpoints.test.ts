// What a module's generated Traefik file is allowed to contain.
//
// The risk this guards is a module reaching past the panel's write surface: an
// id that becomes a second YAML key, a target Traefik cannot dial, or a public
// router where a protected one was meant. See ADR 0048.
import { describe, expect, it } from 'vitest'
import { UnsafeDynamicValueError } from './dynamic.ts'
import {
  moduleEndpointsFile,
  moduleRouterName,
  parseModuleEndpoints,
  renderModuleEndpoints,
  type StoredModuleEndpoint,
} from './module-endpoints.ts'

const endpoint = (over: Partial<StoredModuleEndpoint> = {}): StoredModuleEndpoint => ({
  id: 'web-pr33',
  host: 'web--shop--pr33.example.test',
  entryPoint: 'websecure',
  target: 'shop-pr33-web-1',
  port: 3000,
  mode: 'protected',
  ...over,
})

describe('moduleEndpointsFile', () => {
  it('names one file per module', () => {
    expect(moduleEndpointsFile('taskflow')).toBe('portta-module-taskflow.yaml')
  })
})

describe('renderModuleEndpoints', () => {
  it('renders a router and a service for each endpoint', () => {
    const yaml = renderModuleEndpoints('taskflow', [endpoint()])
    expect(yaml).toContain('portta-module-taskflow-web-pr33:')
    expect(yaml).toContain('rule: "Host(`web--shop--pr33.example.test`)"')
    expect(yaml).toContain('- url: "http://shop-pr33-web-1:3000"')
  })

  it('carries ForwardAuth unless the endpoint is explicitly public', () => {
    expect(renderModuleEndpoints('taskflow', [endpoint()])).toContain('middlewares: [portta-forward-auth]')
    expect(renderModuleEndpoints('taskflow', [endpoint({ mode: 'public' })])).not.toContain('middlewares:')
  })

  it('writes an empty file rather than leaving a stale router behind', () => {
    const yaml = renderModuleEndpoints('taskflow', [])
    expect(yaml).not.toContain('routers:')
    expect(yaml).toContain('publishes nothing')
  })

  it('refuses an id that would become a second YAML key', () => {
    expect(() => renderModuleEndpoints('taskflow', [endpoint({ id: 'web:\n  evil' })])).toThrow(UnsafeDynamicValueError)
    expect(() => renderModuleEndpoints('taskflow', [endpoint({ id: '../escape' })])).toThrow(UnsafeDynamicValueError)
  })

  it('refuses a host that would break out of its quoted rule', () => {
    expect(() => renderModuleEndpoints('taskflow', [endpoint({ host: 'a`) || Host(`b' })])).not.toThrow()
    expect(() => renderModuleEndpoints('taskflow', [endpoint({ host: 'a"b' })])).toThrow(UnsafeDynamicValueError)
  })

  it('refuses two endpoints claiming the same router', () => {
    expect(() => renderModuleEndpoints('taskflow', [endpoint(), endpoint({ host: 'other.test' })])).toThrow(
      UnsafeDynamicValueError,
    )
  })

  it('round-trips through the marker so a restart keeps the set', () => {
    const endpoints = [endpoint(), endpoint({ id: 'api-pr33', port: 8080 })]
    expect(parseModuleEndpoints(renderModuleEndpoints('taskflow', endpoints))).toEqual(endpoints)
  })

  it('reads nothing out of a file it did not write', () => {
    expect(parseModuleEndpoints(null)).toEqual([])
    expect(parseModuleEndpoints('http:\n  routers: {}\n')).toEqual([])
  })
})

describe('moduleRouterName', () => {
  it('namespaces the router by module', () => {
    expect(moduleRouterName('taskflow', 'web-pr33')).toBe('portta-module-taskflow-web-pr33')
  })
})
