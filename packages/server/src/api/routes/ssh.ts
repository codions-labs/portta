import { Hono } from 'hono'
import {
  GenerateSshKey,
  ImportSshKey,
  RemovedSshKey,
  SshKey,
  SshKeys,
  SshTestResult,
  TestSshKey,
} from 'portta-contracts'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { SshKeysService } from '../../services/ssh-keys.ts'
import { record } from '../audit.ts'
import { documentRoute } from '../openapi.ts'

const idParameter = {
  name: 'id',
  in: 'path' as const,
  required: true,
  description: 'The UUID assigned to the Portta-owned key.',
  schema: { type: 'string' as const, format: 'uuid' },
}
const Id = z.string().uuid()

export function sshRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  const service = () => new SshKeysService(deps.db.sshKeys, deps.config.sshDir)

  app.get(
    '/ssh/keys',
    documentRoute({
      tag: 'SSH',
      operationId: 'listSshKeys',
      permission: 'ssh:read',
      summary: 'List Portta-owned SSH keys',
      description:
        'Returns public material and metadata only. Private key material has no response field and never leaves state/ssh.',
      response: SshKeys,
      errors: [401, 403, 500, 503],
    }),
    async (c) => c.json(await service().list()),
  )

  app.post(
    '/ssh/keys',
    documentRoute({
      tag: 'SSH',
      operationId: 'generateSshKey',
      permission: 'ssh:manage',
      summary: 'Generate an SSH key',
      description: 'Generates ED25519 by default or RSA-4096. The private file is created with mode 0600.',
      request: GenerateSshKey,
      response: SshKey,
      status: 201,
      errors: [400, 401, 403, 409, 500, 503],
    }),
    async (c) => {
      const body = GenerateSshKey.parse(await c.req.json())
      const created = await service().generate(body)
      await record(deps, c, {
        action: 'ssh.key_created',
        resourceType: 'ssh_key',
        resourceId: created.id,
        resourceName: created.name,
        metadata: { fingerprint: created.fingerprint },
      })
      return c.json(created, 201)
    },
  )

  app.post(
    '/ssh/keys/import',
    documentRoute({
      tag: 'SSH',
      operationId: 'importSshKey',
      permission: 'ssh:manage',
      summary: 'Import an SSH private key',
      description:
        'Accepts an unencrypted ED25519 or RSA private key. The private input is write-only and is never persisted in the panel database or returned.',
      request: ImportSshKey,
      response: SshKey,
      status: 201,
      errors: [400, 401, 403, 409, 500, 503],
    }),
    async (c) => {
      const body = ImportSshKey.parse(await c.req.json())
      const created = await service().import(body)
      await record(deps, c, {
        action: 'ssh.key_imported',
        resourceType: 'ssh_key',
        resourceId: created.id,
        resourceName: created.name,
        metadata: { fingerprint: created.fingerprint },
      })
      return c.json(created, 201)
    },
  )

  app.delete(
    '/ssh/keys/:id',
    documentRoute({
      tag: 'SSH',
      operationId: 'removeSshKey',
      permission: 'ssh:manage',
      summary: 'Remove an SSH key and its files',
      response: RemovedSshKey,
      parameters: [idParameter],
      errors: [400, 401, 403, 404, 500, 503],
    }),
    async (c) => {
      const id = Id.parse(c.req.param('id'))
      const removed = await service().remove(id)
      await record(deps, c, {
        action: 'ssh.key_removed',
        resourceType: 'ssh_key',
        resourceId: id,
        resourceName: removed.name,
        metadata: { fingerprint: removed.fingerprint },
      })
      return c.json({ ok: true as const, removed: id })
    },
  )

  app.post(
    '/ssh/keys/:id/test',
    documentRoute({
      tag: 'SSH',
      operationId: 'testSshKey',
      permission: 'ssh:manage',
      summary: 'Test a key against a supported forge',
      description:
        'The target is selected from a fixed list. GitHub’s successful greeting counts even though its SSH endpoint exits with status 1.',
      request: TestSshKey,
      response: SshTestResult,
      parameters: [idParameter],
      errors: [400, 401, 403, 404, 500, 503],
    }),
    async (c) => {
      const id = Id.parse(c.req.param('id'))
      const body = TestSshKey.parse(await c.req.json())
      const result = await service().test(id, body.host)
      const key = await deps.db.sshKeys.find(id)
      await record(deps, c, {
        action: 'ssh.key_tested',
        resourceType: 'ssh_key',
        resourceId: id,
        resourceName: key?.name ?? null,
        metadata: { fingerprint: key?.fingerprint ?? null, host: body.host, ok: result.ok },
      })
      return c.json(result)
    },
  )

  return app
}
