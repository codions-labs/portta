import { describe, expect, it } from 'vitest'
import { buildIsolationReport } from '../services/environment-isolation.ts'

describe('buildIsolationReport', () => {
  it('reports global and host-coupled Compose resources', () => {
    const report = buildIsolationReport({
      services: {
        app: {
          container_name: 'singleton',
          ports: ['3000:3000'],
          volumes: ['/var/run/docker.sock:/var/run/docker.sock', '/tmp:/host'],
          devices: ['/dev/kvm'],
        },
      },
      networks: { shared: { external: true } },
    })
    expect(report.isolated).toBe(false)
    expect(report.risks.map((risk) => risk.kind)).toEqual([
      'external_resource',
      'container_name',
      'fixed_host_port',
      'docker_socket',
      'bind_mount',
      'device',
    ])
  })

  it('recognizes normalized Compose port and bind mount objects', () => {
    const report = buildIsolationReport({
      services: {
        app: {
          ports: [{ target: 3000, published: '8080', protocol: 'tcp' }],
          volumes: [{ type: 'bind', source: '/tmp/project', target: '/workspace' }],
        },
      },
    })
    expect(report.risks.map((risk) => risk.kind)).toEqual(['fixed_host_port', 'bind_mount'])
  })
})
