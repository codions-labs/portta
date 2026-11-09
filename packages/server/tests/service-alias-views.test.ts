import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContainerSummary } from 'portta-contracts'
import { renderAliases } from 'portta-core'
import { expect, it } from 'vitest'
import { GATEWAY, PROJECT_A } from './fixtures.ts'
import { databasePerFile, makeApp } from './helpers.ts'

const database = databasePerFile()

it('shows secondary HTTP aliases and their port/protection in every service container view', async () => {
  const seeded = await database()
  const dynamicDir = mkdtempSync(join(tmpdir(), 'portta-service-alias-views-'))
  writeFileSync(
    join(dynamicDir, 'portta-aliases.yaml'),
    renderAliases(
      [
        {
          project: 'alpha',
          service: 'mailpit',
          container: 'alpha-mailpit-1',
          host: 'mail.example.com',
          port: 8025,
          entryPoint: 'websecure',
          forwardAuth: true,
        },
      ],
      true,
    ),
  )
  await seeded.database.settings.setService(seeded.ids.environment, 'mailpit', 'note', 'Mail preview')
  const { app } = makeApp(
    {
      containers: [
        ...GATEWAY,
        ...PROJECT_A,
        {
          id: 'a-mailpit',
          name: 'alpha-mailpit-1',
          image: 'axllent/mailpit:latest',
          networks: ['portta', 'alpha_default'],
          exposed: [1025, 8025],
          labels: {
            'com.docker.compose.project': 'alpha',
            'com.docker.compose.service': 'mailpit',
            'traefik.enable': 'false',
          },
        },
      ],
    },
    { dynamicDir, profile: 'remote-public', tlsEnabled: true },
    seeded.database,
  )

  const [listed, detail, dockerList, dockerDetail] = await Promise.all(
    [
      '/api/services',
      '/api/services/a-mailpit',
      '/api/docker/containers?q=mail.example.com',
      '/api/docker/containers/a-mailpit',
    ].map(async (path) => (await app.request(path)).json()),
  )
  const mailpit = (listed.services as ContainerSummary[]).find((container) => container.service === 'mailpit')!
  for (const service of [mailpit, detail, dockerList.containers[0], dockerDetail]) {
    expect(service).toMatchObject({ kind: 'smtp', overrides: { note: 'Mail preview' } })
    expect(service.urls).toEqual([
      expect.objectContaining({ host: 'mail.example.com', targetPort: 8025, forwardAuth: true }),
    ])
  }
  expect(dockerList.containers).toHaveLength(1)
  expect((listed.services as ContainerSummary[]).find((container) => container.service === 'web')!.urls[0]!.host).toBe(
    'alpha--web.localhost',
  )
  const gateway = await (await app.request('/api/docker/containers/gw-auth')).json()
  expect(gateway.urls).toEqual([])
  expect(gateway.overrides).toBeUndefined()
})
