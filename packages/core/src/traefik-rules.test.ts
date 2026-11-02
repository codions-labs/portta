import { describe, expect, it } from 'vitest'
import { hasForwardAuth, opensUnknownHosts, routingGateStatus } from './forward-auth.ts'
import { httpRoutes, isTcpOnly, ruleHosts, traefikEnabled } from './traefik-rules.ts'

const GATE = 'portta-forward-auth@file'

describe('ruleHosts', () => {
  it.each([
    ['a backtick host', 'Host(`a.test`)', ['a.test'], false],
    ['a double-quoted host', 'Host("a.test")', ['a.test'], false],
    ['every spelling Traefik registers', 'host(`a.test`) || HOST(`b.test`)', ['a.test', 'b.test'], false],
    ['several values, the v2 syntax', 'Host(`a.test`, `b.test`)', ['a.test', 'b.test'], false],
    ['lowercase, as Traefik compares it', 'Host(`A.Test`)', ['a.test'], false],
    ['a host narrowed by a path', 'Host(`a.test`) && PathPrefix(`/api`)', ['a.test'], false],
    ['a path narrowed by a host', 'PathPrefix(`/api`) && Host(`a.test`)', ['a.test'], false],
    ['a negation beside a host', 'Host(`a.test`) && !Host(`b.test`)', ['a.test'], false],
    ['grouping', '(Host(`a.test`) || Host(`b.test`)) && Path(`/`)', ['a.test', 'b.test'], false],
    ['no Host at all', 'PathPrefix(`/`)', [], true],
    ['a regexp', 'HostRegexp(`^.+\\.test$`)', [], true],
    ['a wildcard', 'Host(`*.test`)', [], true],
    ['a negated host', '!Host(`a.test`)', [], true],
    ['a host or anything on a path', 'Host(`a.test`) || PathPrefix(`/x`)', ['a.test'], true],
    ['a name that is not Host', 'HostSNI(`a.test`)', [], true],
    ['single quotes, which Traefik refuses', "Host('a.test')", [], true],
    ['text that does not parse', 'Host(`a.test`', [], true],
    ['an escape, which only Go would decode', 'Host("a\\x2etest")', [], true],
  ])('reads %s', (_name, rule, hosts, unknown) => {
    expect(ruleHosts(rule)).toEqual({ hosts, unknown })
  })
})

describe('traefikEnabled', () => {
  it.each(['true', 'True', 'TRUE', '1', 't', ' true '])('counts %s', (value) => {
    expect(traefikEnabled({ 'traefik.enable': value })).toBe(true)
  })

  it.each(['false', '0', '', 'yes'])('does not count %s', (value) => {
    expect(traefikEnabled({ 'traefik.enable': value })).toBe(false)
  })

  it('reads the key in any case', () => {
    expect(traefikEnabled({ 'TRAEFIK.ENABLE': 'true' })).toBe(true)
    expect(traefikEnabled({})).toBe(false)
  })
})

describe('httpRoutes', () => {
  it('reads keys in any case', () => {
    expect(httpRoutes({ 'TRAEFIK.HTTP.ROUTERS.Web.RULE': 'Host(`a.test`)' }).hosts).toEqual(['a.test'])
  })

  it('uses the default rule with no router, or a router with no rule', () => {
    expect(httpRoutes({ 'traefik.enable': 'true' }).usesDefaultRule).toBe(true)
    expect(httpRoutes({ 'traefik.http.routers.web.middlewares': GATE }).usesDefaultRule).toBe(true)
    expect(httpRoutes({ 'traefik.http.routers.web.rule': '  ' }).usesDefaultRule).toBe(true)
  })

  it('does not use it when every router names its own rule', () => {
    expect(httpRoutes({ 'traefik.http.routers.web.rule': 'PathPrefix(`/`)' })).toEqual({
      hosts: [],
      usesDefaultRule: false,
      unknownHosts: true,
    })
  })

  it('collects every router, and does not trust labels that contradict themselves', () => {
    const routes = httpRoutes({
      'traefik.http.routers.a.rule': 'Host(`a.test`)',
      'traefik.http.routers.b.rule': 'Host(`b.test`)',
      'TRAEFIK.HTTP.ROUTERS.A.RULE': 'Host(`c.test`)',
    })
    expect(routes.unknownHosts).toBe(true)
  })
})

describe('isTcpOnly', () => {
  it('reads keys in any case', () => {
    expect(isTcpOnly({ 'TRAEFIK.TCP.ROUTERS.db.RULE': 'HostSNI(`a`)' })).toBe(true)
    expect(isTcpOnly({ 'traefik.tcp.routers.db.rule': 'x', 'traefik.http.routers.web.rule': 'y' })).toBe(false)
  })
})

describe('the gate', () => {
  const enabled = { 'traefik.enable': 'True' }

  it('keeps its verdicts now that it reads through the shared labels', () => {
    expect(routingGateStatus({})).toBe('disabled')
    expect(routingGateStatus(enabled)).toBe('ungated')
    expect(
      hasForwardAuth({
        ...enabled,
        'traefik.http.routers.web.rule': 'Host(`a.test`)',
        'traefik.http.routers.web.middlewares': GATE,
      }),
    ).toBe(true)
    expect(
      routingGateStatus({
        ...enabled,
        'traefik.tcp.routers.db.rule': 'HostSNI(`*`)',
        'traefik.tcp.routers.db.entrypoints': 'postgres',
      }),
    ).toBe('private-tcp')
    expect(routingGateStatus({ ...enabled, 'traefik.tcp.routers.db.rule': 'HostSNI(`*`)' })).toBe('ungated')
  })

  it.each([
    ['a path with no gate', { 'traefik.http.routers.web.rule': 'PathPrefix(`/`)' }],
    ['a regexp with no gate', { 'traefik.http.routers.web.rule': 'HostRegexp(`.+`)' }],
    ['a rule that does not parse', { 'traefik.http.routers.web.rule': 'Host(' }],
    ['a TCP router on the public entrypoints', { 'traefik.tcp.routers.db.rule': 'HostSNI(`*`)' }],
    ['labels that contradict themselves', { 'traefik.http.routers.w.rule': 'a', 'TRAEFIK.HTTP.ROUTERS.W.RULE': 'b' }],
  ])('calls %s open on unknown names', (_name, labels) => {
    expect(opensUnknownHosts({ ...enabled, ...labels })).toBe(true)
  })

  it.each([
    ['a host with no gate, which has a name', { 'traefik.http.routers.web.rule': 'Host(`a.test`)' }],
    ['no router, which gets the default name', {}],
    [
      'a path behind the gate',
      { 'traefik.http.routers.web.rule': 'PathPrefix(`/`)', 'traefik.http.routers.web.middlewares': GATE },
    ],
  ])('does not call %s open on unknown names', (_name, labels) => {
    expect(opensUnknownHosts({ ...enabled, ...labels })).toBe(false)
  })

  it('looks at the open router, not one behind the gate', () => {
    expect(
      opensUnknownHosts({
        ...enabled,
        'traefik.http.routers.a.rule': 'PathPrefix(`/`)',
        'traefik.http.routers.a.middlewares': GATE,
        'traefik.http.routers.b.rule': 'Host(`b.test`)',
      }),
    ).toBe(false)
  })

  it('has nothing to say about a container that did not opt in', () => {
    expect(opensUnknownHosts({ 'traefik.http.routers.web.rule': 'PathPrefix(`/`)' })).toBe(false)
  })
})
