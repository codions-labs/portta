import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assessDevcontainerSecurity, findDevcontainerConfigs } from '../adapters/devcontainer-environment.ts'

describe('findDevcontainerConfigs', () => {
  it('finds spec locations in deterministic order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taskflow-devcontainer-'))
    await mkdir(join(root, '.devcontainer', 'node'), { recursive: true })
    await writeFile(join(root, '.devcontainer.json'), '{}')
    await writeFile(join(root, '.devcontainer', 'devcontainer.json'), '{}')
    await writeFile(join(root, '.devcontainer', 'node', 'devcontainer.json'), '{}')
    await expect(findDevcontainerConfigs(root)).resolves.toEqual([
      join(root, '.devcontainer.json'),
      join(root, '.devcontainer', 'devcontainer.json'),
      join(root, '.devcontainer', 'node', 'devcontainer.json'),
    ])
  })
})

describe('assessDevcontainerSecurity', () => {
  it('reports host and privilege boundaries', () => {
    const result = assessDevcontainerSecurity({
      mergedConfiguration: {
        initializeCommand: 'echo unsafe',
        privileged: true,
        mounts: [
          'source=/,target=/host,type=bind',
          'source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind',
          { source: '${localEnv:HOME}', target: '/host-home', type: 'bind' },
        ],
        runArgs: ['--device=/dev/kvm', '--cap-add=SYS_ADMIN', '--security-opt', 'seccomp=unconfined'],
        remoteEnv: { API_TOKEN: '${localEnv:API_TOKEN}' },
        features: { 'ghcr.io/devcontainers/features/node:1': {} },
      },
    })
    expect(result).toMatchObject({
      initializeCommand: true,
      privileged: true,
      dockerSocket: true,
      devices: true,
      broadMounts: true,
      addedCapabilities: ['SYS_ADMIN'],
      securityOptions: ['seccomp=unconfined'],
      secretKeys: ['API_TOKEN'],
      unpinnedFeatures: ['ghcr.io/devcontainers/features/node:1'],
    })
    expect(result.features).toEqual(['ghcr.io/devcontainers/features/node:1'])
  })
})
