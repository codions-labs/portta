// The host the end-to-end run describes: a gateway, one adopted project, a
// Compose project that never adopted it, and two containers started by hand.
// Small on purpose, so an assertion can name everything on it.
//
// The viewport check uses a larger host: see demo-host.mjs.

import { composeLabels, gatewayLabels, makeContainer, volume } from './container.mjs'

export function initialState() {
  return [
    makeContainer({
      id: 'gwtraefik',
      name: 'portta-traefik-1',
      image: 'traefik:v3.7.12',
      health: 'healthy',
      networks: ['portta', 'portta-control'],
      labels: gatewayLabels('traefik'),
      published: [
        { hostIp: '127.0.0.1', hostPort: 80, containerPort: 80 },
        { hostIp: '127.0.0.1', hostPort: 443, containerPort: 443 },
      ],
    }),
    makeContainer({
      id: 'gwproxy',
      name: 'portta-socket-proxy-1',
      image: 'tecnativa/docker-socket-proxy:v0.5.0',
      networks: ['portta-control'],
      labels: gatewayLabels('socket-proxy'),
    }),
    // Prepared and never started: the state `portta up` leaves the applier in
    // on a host with PORTTA_APPLY=true.
    makeContainer({
      id: 'gwapply',
      name: 'portta-apply',
      image: 'codions-labs/portta-apply:0.1.0',
      state: 'created',
      startedAt: '0001-01-01T00:00:00Z',
      networks: [],
      labels: gatewayLabels('apply'),
    }),
    makeContainer({
      id: 'alphaweb',
      name: 'alpha-web-1',
      image: 'nginx:1.31.4-alpine',
      health: 'healthy',
      networks: ['portta', 'alpha_default'],
      exposed: [80],
      labels: {
        ...composeLabels({
          project: 'alpha',
          service: 'web',
          workingDir: '/srv/dev/alpha',
          routed: true,
        }),
        'traefik.http.routers.alpha-web.rule': 'Host(`alpha-web.localhost`) || Host(`alpha-preview.localhost`)',
      },
    }),
    makeContainer({
      id: 'alphapg',
      name: 'alpha-postgres-1',
      image: 'postgres:18.6-alpine',
      health: 'healthy',
      networks: ['alpha_default'],
      exposed: [5432],
      labels: composeLabels({ project: 'alpha', service: 'postgres' }),
      mounts: [volume('alpha_pgdata', '/var/lib/postgresql')],
    }),
    makeContainer({
      id: 'externalpg',
      name: 'external-postgres',
      image: 'postgres:18.6-alpine',
      networks: ['external_default'],
      exposed: [5432],
      published: [{ hostIp: '0.0.0.0', hostPort: 5432, containerPort: 5432 }],
      labels: composeLabels({ project: 'external', service: 'postgres' }),
      mounts: [volume('external_pgdata', '/var/lib/postgresql')],
    }),
    makeContainer({
      id: 'mailpit',
      name: 'mailpit',
      image: 'axllent/mailpit:v1.20.0',
      networks: ['bridge'],
      exposed: [1025],
      published: [{ hostIp: '0.0.0.0', hostPort: 8025, containerPort: 8025 }],
    }),
    makeContainer({
      id: 'oldbox',
      name: 'some-old-container',
      image: 'busybox:1.37.0',
      state: 'exited',
      networks: ['bridge'],
    }),
  ]
}

export const NETWORKS = [
  {
    Id: 'net-gateway',
    Name: 'portta',
    Driver: 'bridge',
    Scope: 'local',
    Internal: false,
    Labels: { 'portta.managed': 'true' },
    Containers: {},
  },
  {
    Id: 'net-control',
    Name: 'portta-control',
    Driver: 'bridge',
    Scope: 'local',
    Internal: true,
    Labels: { 'portta.managed': 'true' },
    Containers: {},
  },
  {
    Id: 'net-alpha',
    Name: 'alpha_default',
    Driver: 'bridge',
    Scope: 'local',
    Internal: false,
    Labels: {},
    Containers: {},
  },
]
