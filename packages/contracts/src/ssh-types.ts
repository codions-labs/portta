import { z } from 'portta-core/zod'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T
const unixSeconds = z.number().describe('Unix timestamp in seconds')

export const SshAlgorithm = named(z.enum(['ed25519', 'rsa']), 'SshAlgorithm')
export type SshAlgorithm = z.infer<typeof SshAlgorithm>

/** Public material and metadata only. A private-key field does not exist here. */
export const SshKey = named(
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string().nullable(),
      algorithm: SshAlgorithm,
      bits: z.number().int().nullable(),
      fingerprint: z.string(),
      publicKey: z.string(),
      origin: z.enum(['generated', 'imported']),
      createdAt: unixSeconds,
    })
    .strict(),
  'SshKey',
)
export type SshKey = z.infer<typeof SshKey>

export const SshKeys = named(z.object({ keys: z.array(SshKey) }).strict(), 'SshKeys')
export type SshKeys = z.infer<typeof SshKeys>

export const GenerateSshKey = named(
  z
    .object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500).optional(),
      algorithm: SshAlgorithm.default('ed25519'),
    })
    .strict(),
  'GenerateSshKey',
)
export type GenerateSshKey = z.infer<typeof GenerateSshKey>

export const ImportSshKey = named(
  z
    .object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500).optional(),
      /** Write-only input. No response schema contains this field. */
      privateKey: z
        .string()
        .min(64)
        .max(64 * 1024),
    })
    .strict(),
  'ImportSshKey',
)
export type ImportSshKey = z.infer<typeof ImportSshKey>

export const SshForge = named(z.enum(['github.com', 'gitlab.com', 'bitbucket.org']), 'SshForge')
export type SshForge = z.infer<typeof SshForge>

export const TestSshKey = named(z.object({ host: SshForge }).strict(), 'TestSshKey')
export type TestSshKey = z.infer<typeof TestSshKey>

export const SshTestResult = named(
  z
    .object({
      host: SshForge,
      ok: z.boolean(),
      message: z.string(),
    })
    .strict(),
  'SshTestResult',
)
export type SshTestResult = z.infer<typeof SshTestResult>

export const RemovedSshKey = named(
  z.object({ ok: z.literal(true), removed: z.string().uuid() }).strict(),
  'RemovedSshKey',
)
export type RemovedSshKey = z.infer<typeof RemovedSshKey>
