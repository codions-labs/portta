// The larger host `npm run viewports` checks the pages' layout against.
//
// It is a plausible workstation rather than any particular machine: the
// example products (demo-shop, demo-a, demo-monorepo), a second
// worktree of the shop, a external stack that never adopted the gateway,
// containers somebody started by hand and forgot, an open TCP bridge, one
// unhealthy service and one port claimed twice. Everything the panel is for
// is visible at once, so a page that overflows its viewport shows it here.
// The documentation screenshots come from `just dev --demo` instead: see
// e2e/screenshots.mjs.

import { composeLabels, gatewayLabels, makeBridge, makeContainer, volume } from './container.mjs'

const HOUR = 3600
const DAY = 24 * HOUR

const WHOAMI = 'traefik/whoami:v1.12.0'
const POSTGRES = 'postgres:18.6-alpine'
const REDIS = 'redis:8.10.1-alpine'
const NGINX = 'nginx:1.31.4-alpine'

export function initialState() {
  return [
    // ---- the gateway itself ------------------------------------------
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
      upSeconds: 6 * DAY,
    }),
    makeContainer({
      id: 'gwproxy',
      name: 'portta-socket-proxy-1',
      image: 'tecnativa/docker-socket-proxy:v0.5.0',
      health: 'healthy',
      networks: ['portta-control'],
      labels: gatewayLabels('socket-proxy'),
      upSeconds: 6 * DAY,
    }),
    makeContainer({
      id: 'gwweb',
      name: 'portta-web-1',
      image: 'codions-labs/portta:local',
      health: 'healthy',
      networks: ['portta', 'portta-web'],
      labels: gatewayLabels('web'),
      published: [{ hostIp: '127.0.0.1', hostPort: 8081, containerPort: 8081 }],
      upSeconds: 4 * HOUR,
    }),
    makeContainer({
      id: 'gwwebproxy',
      name: 'portta-web-socket-proxy-1',
      image: 'tecnativa/docker-socket-proxy:v0.5.0',
      health: 'healthy',
      networks: ['portta-web'],
      labels: gatewayLabels('web-socket-proxy'),
      upSeconds: 4 * HOUR,
    }),
    // The database and the ForwardAuth service. A host without them is a host
    // `doctor` is right to complain about, and the documentation's own
    // screenshots are of a healthy host rather than of that complaint.
    makeContainer({
      id: 'gwdb',
      name: 'portta-db-1',
      image: 'postgres:18.6-alpine',
      health: 'healthy',
      networks: ['portta-data'],
      labels: gatewayLabels('db'),
      upSeconds: 4 * HOUR,
    }),
    makeContainer({
      id: 'gwauth',
      name: 'portta-portta-auth-1',
      image: 'codions-labs/portta:local',
      health: 'healthy',
      networks: ['portta'],
      labels: gatewayLabels('auth'),
      upSeconds: 4 * HOUR,
    }),

    // ---- demo-shop: the project being worked on ----------------------
    makeContainer({
      id: 'sfweb',
      name: 'demo-shop-web-1',
      image: NGINX,
      health: 'healthy',
      networks: ['portta', 'demo-shop_default'],
      exposed: [3000],
      labels: {
        ...composeLabels({
          project: 'demo-shop',
          logicalProject: 'demo-shop',
          service: 'web',
          workingDir: '/Projects/demo-shop',
          routed: true,
          port: 3000,
        }),
        'traefik.http.routers.demo-shop-web.rule':
          'Host(`demo-shop-web.localhost`) || Host(`demo-shop-preview.localhost`)',
      },
      upSeconds: 3 * HOUR,
    }),
    makeContainer({
      id: 'sfapi',
      name: 'demo-shop-api-1',
      image: WHOAMI,
      health: 'healthy',
      networks: ['portta', 'demo-shop_default'],
      exposed: [8000],
      labels: composeLabels({
        project: 'demo-shop',
        logicalProject: 'demo-shop',
        service: 'api',
        workingDir: '/Projects/demo-shop',
        routed: true,
        port: 8000,
      }),
      upSeconds: 3 * HOUR,
    }),
    makeContainer({
      id: 'sfpg',
      name: 'demo-shop-postgres-1',
      image: POSTGRES,
      health: 'healthy',
      networks: ['demo-shop_default', 'portta-access'],
      exposed: [5432],
      labels: {
        ...composeLabels({
          project: 'demo-shop',
          logicalProject: 'demo-shop',
          service: 'postgres',
          workingDir: '/Projects/demo-shop',
        }),
        // Opted into hostname routing: reachable at
        // demo-shop-postgres.localhost:5432 without publishing a port.
        'traefik.enable': 'true',
        'traefik.docker.network': 'portta-access',
        'traefik.tcp.routers.demo-shop-postgres.rule': 'HostSNIRegexp(`^demo-shop-postgres\\..+$`)',
        'traefik.tcp.routers.demo-shop-postgres.tls': 'true',
        'traefik.tcp.routers.demo-shop-postgres.tls.options': 'postgres@file',
      },
      mounts: [volume('demo-shop_pgdata', '/var/lib/postgresql')],
      upSeconds: 3 * HOUR,
    }),
    makeContainer({
      id: 'sfredis',
      name: 'demo-shop-redis-1',
      image: REDIS,
      health: 'healthy',
      networks: ['demo-shop_default', 'portta-access'],
      exposed: [6379],
      labels: {
        ...composeLabels({
          project: 'demo-shop',
          logicalProject: 'demo-shop',
          service: 'redis',
          workingDir: '/Projects/demo-shop',
        }),
        'traefik.enable': 'true',
        'traefik.docker.network': 'portta-access',
        'traefik.tcp.routers.demo-shop-redis.rule': 'HostSNIRegexp(`^demo-shop-redis\\..+$`)',
        'traefik.tcp.routers.demo-shop-redis.tls': 'true',
      },
      upSeconds: 3 * HOUR,
    }),

    // ---- the same project, a second worktree, running side by side ----
    makeContainer({
      id: 'sf312web',
      name: 'demo-shop-issue312-web-1',
      image: WHOAMI,
      health: 'healthy',
      networks: ['portta', 'demo-shop-issue312_default'],
      exposed: [3000],
      labels: composeLabels({
        project: 'demo-shop-issue312',
        logicalProject: 'demo-shop',
        service: 'web',
        workingDir: '/Projects/worktrees/issue-312',
        routed: true,
        port: 3000,
      }),
      upSeconds: 40 * 60,
    }),
    makeContainer({
      id: 'sf312api',
      name: 'demo-shop-issue312-api-1',
      image: WHOAMI,
      networks: ['portta', 'demo-shop-issue312_default'],
      exposed: [8000],
      labels: composeLabels({
        project: 'demo-shop-issue312',
        logicalProject: 'demo-shop',
        service: 'api',
        workingDir: '/Projects/worktrees/issue-312',
        routed: true,
        port: 8000,
      }),
      upSeconds: 40 * 60,
    }),
    makeContainer({
      id: 'sf312pg',
      name: 'demo-shop-issue312-postgres-1',
      image: POSTGRES,
      health: 'healthy',
      networks: ['demo-shop-issue312_default'],
      exposed: [5432],
      labels: composeLabels({
        project: 'demo-shop-issue312',
        logicalProject: 'demo-shop',
        service: 'postgres',
        workingDir: '/Projects/worktrees/issue-312',
      }),
      mounts: [volume('demo-shop-issue312_pgdata', '/var/lib/postgresql')],
      upSeconds: 40 * 60,
    }),

    // ---- demo-a: the short stack used in gateway tests -------------------
    makeContainer({
      id: 'daweb',
      name: 'demo-a-web-1',
      image: WHOAMI,
      health: 'healthy',
      networks: ['portta', 'demo-a_default'],
      exposed: [80],
      labels: composeLabels({
        project: 'demo-a',
        logicalProject: 'demo-a',
        service: 'web',
        workingDir: '/Projects/demo-a',
        routed: true,
        port: 80,
      }),
      upSeconds: 12 * HOUR,
    }),
    makeContainer({
      id: 'daapi',
      name: 'demo-a-api-1',
      image: WHOAMI,
      health: 'healthy',
      networks: ['portta', 'demo-a_default'],
      exposed: [8000],
      labels: composeLabels({
        project: 'demo-a',
        logicalProject: 'demo-a',
        service: 'api',
        workingDir: '/Projects/demo-a',
        routed: true,
        port: 8000,
      }),
      upSeconds: 12 * HOUR,
    }),

    // ---- demo-monorepo: another project, with something wrong with it ------
    makeContainer({
      id: 'ckweb',
      name: 'demo-monorepo-web-1',
      image: WHOAMI,
      health: 'healthy',
      networks: ['portta', 'demo-monorepo_default'],
      exposed: [3000],
      labels: composeLabels({
        project: 'demo-monorepo',
        logicalProject: 'demo-monorepo',
        service: 'web',
        workingDir: '/Projects/demo-monorepo',
        routed: true,
        port: 3000,
      }),
      upSeconds: 26 * HOUR,
    }),
    makeContainer({
      id: 'ckworker',
      name: 'demo-monorepo-worker-1',
      image: 'python:3.13-alpine',
      health: 'unhealthy',
      networks: ['demo-monorepo_default'],
      labels: composeLabels({
        project: 'demo-monorepo',
        logicalProject: 'demo-monorepo',
        service: 'worker',
        workingDir: '/Projects/demo-monorepo',
      }),
      upSeconds: 26 * HOUR,
    }),
    makeContainer({
      id: 'ckpg',
      name: 'demo-monorepo-postgres-1',
      image: POSTGRES,
      health: 'healthy',
      networks: ['demo-monorepo_default'],
      exposed: [5432],
      labels: composeLabels({
        project: 'demo-monorepo',
        logicalProject: 'demo-monorepo',
        service: 'postgres',
        workingDir: '/Projects/demo-monorepo',
      }),
      mounts: [volume('demo-monorepo_pgdata', '/var/lib/postgresql')],
      upSeconds: 26 * HOUR,
    }),

    makeContainer({
      id: 'ckexternal',
      name: 'demo-monorepo-mysql-1',
      image: 'mariadb:11.4.9',
      health: 'healthy',
      networks: ['demo-monorepo_default'],
      exposed: [3306],
      labels: composeLabels({
        project: 'demo-monorepo',
        logicalProject: 'demo-monorepo',
        service: 'mysql',
        workingDir: '/Projects/demo-monorepo',
      }),
      mounts: [volume('demo-monorepo_mysqldata', '/var/lib/mysql')],
      upSeconds: 26 * HOUR,
    }),

    makeContainer({
      id: 'ckmail',
      name: 'demo-monorepo-mailpit-1',
      image: 'axllent/mailpit:v1.31.0',
      health: 'healthy',
      networks: ['portta', 'demo-monorepo_default'],
      exposed: [8025, 1025],
      labels: {
        ...composeLabels({
          project: 'demo-monorepo',
          logicalProject: 'demo-monorepo',
          service: 'mailpit',
          workingDir: '/Projects/demo-monorepo',
          routed: true,
          port: 8025,
        }),
        'traefik.http.routers.demo-monorepo-mailpit.rule':
          'Host(`demo-monorepo-mailpit.localhost`) || Host(`mail.demo-monorepo.localhost`)',
      },
      upSeconds: 26 * HOUR,
    }),
    makeContainer({
      id: 'ckrustfs',
      name: 'demo-monorepo-rustfs-1',
      image: 'rustfs/rustfs:1.0.0-rc.4',
      health: 'healthy',
      networks: ['portta', 'demo-monorepo_default'],
      exposed: [9000, 9001],
      labels: composeLabels({
        project: 'demo-monorepo',
        logicalProject: 'demo-monorepo',
        service: 'rustfs',
        workingDir: '/Projects/demo-monorepo',
        routed: true,
        port: 9001,
      }),
      mounts: [volume('demo-monorepo_rustfsdata', '/data')],
      upSeconds: 26 * HOUR,
    }),

    // ---- a stack that never adopted the gateway -----------------------
    makeContainer({
      id: 'lgapi',
      name: 'external-billing-api-1',
      image: 'external-billing-api:dev',
      networks: ['external-billing_default'],
      exposed: [8000],
      published: [{ hostIp: '127.0.0.1', hostPort: 8090, containerPort: 8000 }],
      labels: composeLabels({
        project: 'external-billing',
        service: 'api',
        workingDir: '/Projects/external-billing',
      }),
      upSeconds: 9 * DAY,
    }),
    makeContainer({
      id: 'lgpg',
      name: 'external-billing-postgres-1',
      image: 'postgres:14-alpine',
      health: 'healthy',
      networks: ['external-billing_default'],
      exposed: [5432],
      published: [{ hostIp: '127.0.0.1', hostPort: 5432, containerPort: 5432 }],
      labels: composeLabels({
        project: 'external-billing',
        service: 'postgres',
        workingDir: '/Projects/external-billing',
      }),
      mounts: [volume('external-billing_pgdata', '/var/lib/postgresql/data')],
      upSeconds: 9 * DAY,
    }),

    // ---- started by hand, and forgotten -------------------------------
    makeContainer({
      id: 'mailpit',
      name: 'mailpit',
      image: 'axllent/mailpit:v1.31.0',
      health: 'healthy',
      networks: ['bridge'],
      exposed: [1025],
      published: [{ hostIp: '0.0.0.0', hostPort: 8025, containerPort: 8025 }],
      upSeconds: 21 * DAY,
    }),
    makeContainer({
      id: 'pgscratch',
      name: 'pg-scratch',
      image: 'postgres:16-alpine',
      networks: ['bridge'],
      exposed: [5432],
      // A second claim on 5432, on another interface. The panel flags it, and
      // this is usually the answer to "why will my database not start".
      published: [{ hostIp: '192.168.64.2', hostPort: 5432, containerPort: 5432 }],
      mounts: [volume('pg-scratch-data', '/var/lib/postgresql/data')],
      upSeconds: 5 * DAY,
    }),
    makeContainer({
      id: 'oldbox',
      name: 'import-script-run',
      image: 'alpine:3.24.1',
      state: 'exited',
      networks: ['bridge'],
      upSeconds: 0,
    }),

    // ---- an access bridge somebody opened this morning ----------------
    makeBridge({
      id: 'bridge1',
      name: 'portta-access-demo-shop-postgres-a41f2c',
      targetPort: 5432,
      hostPort: 55431,
      network: 'demo-shop_default',
      labels: {
        'portta.managed': 'true',
        'portta.component': 'access-bridge',
        'portta.access.id': 'a41f2c',
        'portta.access.project': 'demo-shop',
        'portta.access.service': 'postgres',
        'portta.access.port': '5432',
        'portta.access.network': 'demo-shop_default',
        'portta.access.kind': 'postgres',
        'portta.access.created': String(Math.floor(Date.now() / 1000) - 900),
        'traefik.enable': 'false',
      },
    }),
  ]
}

function network(name, { internal = false, managed = false } = {}) {
  return {
    Id: `net-${name}`,
    Name: name,
    Driver: 'bridge',
    Scope: 'local',
    Internal: internal,
    Labels: managed ? { 'portta.managed': 'true' } : {},
    Containers: {},
  }
}

/** What `GET /info` answers. A plausible workstation, not this machine. */
export const INFO = {
  Name: 'workstation',
  Images: 64,
  NCPU: 10,
  MemTotal: 34_359_738_368,
  OperatingSystem: 'OrbStack',
  Architecture: 'aarch64',
  ServerVersion: '29.4.0',
}

export const NETWORKS = [
  network('portta', { managed: true }),
  network('portta-control', { internal: true, managed: true }),
  network('portta-web', { internal: true, managed: true }),
  network('portta-data', { internal: true, managed: true }),
  network('portta-access', { managed: true }),
  network('demo-shop_default'),
  network('demo-shop-issue312_default'),
  network('demo-a_default'),
  network('demo-monorepo_default'),
  network('external-billing_default'),
  network('bridge'),
]
