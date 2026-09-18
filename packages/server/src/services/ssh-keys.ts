// The deliberately small SSH boundary.
//
// There is no arbitrary command endpoint here. Every executable, argument and
// forge hostname is selected by Portta. Private material is read only to hand
// it to OpenSSH by filename and is never returned, logged or put in an Error.

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SshAlgorithm, SshForge, SshTestResult } from 'portta-contracts'
import type { NewSshKeyRecord, SshKeyRecord, SshKeysRepository } from '../db/index.ts'

const FORGES: ReadonlySet<string> = new Set(['github.com', 'gitlab.com', 'bitbucket.org'])

/**
 * Published SSH host keys for the three forges the panel may greet.
 *
 * `accept-new` would trust the first answer on an untrusted network. These
 * entries come from each forge's published catalogue so a test uses
 * `StrictHostKeyChecking=yes` against a file we wrote.
 */
const FORGE_KNOWN_HOSTS: Readonly<Record<SshForge, readonly string[]>> = {
  'github.com': [
    'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
    'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=',
    'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=',
  ],
  'gitlab.com': [
    'gitlab.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAfuCHKVTjquxvt6CM6tdG4SLp1Btn/nOeHHE5UOzRdf',
    'gitlab.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBFSMqzJeV9rUzU4kWitGjeR4PWSa29SPqJ1fVkhtj3Hw9xjLVXVYrU9QlYWrOLXBpQ6KWjbjTDTdDkoohFzgbEY=',
    'gitlab.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCsj2bNKTBSpIYDEGk9KxsGh3mySTRgMtXL583qmBpzeQ+jqCMRgBqB98u3z++J1sKlXHWfM9dyhSevkMwSbhoR8XIq/U0tCNyokEi/ueaBMCvbcTHhO7FcwzY92WK4Yt0aGROY5qX2UKSeOvuP4D6TPqKF1onrSzH9bx9XUf2lEdWT/ia1NEKjunUqu1xOB/StKDHMoX4/OKyIzuS0q/T1zOATthvasJFoPrAjkohTyaDUz2LN5JoH839hViyEG82yB+MjcFV5MU3N1l1QL3cVUCh93xSaua1N85qivl+siMkPGbO5xR/En4iEY6K2XPASUEMaieWVNTRCtJ4S8H+9',
  ],
  'bitbucket.org': [
    'bitbucket.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO',
    'bitbucket.org ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBPIQmuzMBuKdWeF4+a2sjSSpBK0iqitSQ+5BM9KhpexuGt20JpTVM7u5BDZngncgrqDMbWdxMWWOGtZ9UgbqgZE=',
    'bitbucket.org ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDQeJzhupRu0u0cdegZIa8e86EG2qOCsIsD1Xw0xSeiPDlCr7kq97NLmMbpKTX6Esc30NuoqEEHCuc7yWtwp8dI76EEEB1VqY9QJq6vk+aySyboD5QF61I/1WeTwu+deCbgKMGbUijeXhtfbxSxm6JwGrXrhBdofTsbKRUsrN1WoNgUa8uqN1Vx6WAJw1JHPhglEGGHea6QICwJOAr/6mrui/oB7pkaWKHj3z7d1IC4KWLtY47elvjbaTlkN04Kc/5LFEirorGYVbt15kAUlqGM65pk6ZBxtaO3+30LVlORZkxOh+LKL/BvbZ/iRNhItLqNyieoQj/uh/7Iv4uyH/cV/0b4WDSd3DptigWq84lJubb9t/DnZlrJazxyDCulTmKdOR7vs9gMTo+uoIrPSb8ScTtvw65+odKAlBj59dhnVp9zd7QUojOpXlL62Aw56U4oO+FALuevvMjiWeavKhJqlR7i5n9srYcrNV7ttmDw7kf/97P5zauIhxcjX+xHv4M=',
  ],
}

export function forgeKnownHosts(host: SshForge): string {
  return `${FORGE_KNOWN_HOSTS[host].join('\n')}\n`
}

export class SshKeyRefused extends Error {
  readonly status: 400 | 404 | 409 | 503
  readonly hint?: string

  constructor(status: 400 | 404 | 409 | 503, message: string, hint?: string) {
    super(message)
    this.name = 'SshKeyRefused'
    this.status = status
    this.hint = hint
  }
}

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

function run(file: string, args: readonly string[], timeout = 12_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout, maxBuffer: 128 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof (error as NodeJS.ErrnoException).code === 'string') {
        reject(new SshKeyRefused(503, 'OpenSSH tooling is unavailable in the panel runtime'))
        return
      }
      resolve({
        code: error ? ('code' in error && typeof error.code === 'number' ? error.code : -1) : 0,
        stdout,
        stderr,
      })
    })
  })
}

export function parsePublicKey(publicKey: string): { algorithm: SshAlgorithm; bits: number | null } {
  const prefix = publicKey.trim().split(/\s+/, 1)[0]
  if (prefix === 'ssh-ed25519') return { algorithm: 'ed25519', bits: null }
  if (prefix === 'ssh-rsa') return { algorithm: 'rsa', bits: null }
  throw new SshKeyRefused(400, 'only ED25519 and RSA SSH private keys are supported')
}

export function parseFingerprint(output: string): { fingerprint: string; bits: number | null } {
  const match = output.trim().match(/^(\d+)\s+(SHA256:[A-Za-z0-9+/]+)(?:\s|$)/)
  const bits = match?.[1]
  const fingerprint = match?.[2]
  if (!bits || !fingerprint) throw new SshKeyRefused(400, 'could not read the SSH key fingerprint')
  return { bits: Number(bits), fingerprint }
}

export function forgeTestResult(host: SshForge, result: CommandResult): SshTestResult {
  const response = `${result.stdout}\n${result.stderr}`
  const greeting = /successfully authenticated|welcome to gitlab|logged in as/i.test(response)
  if (result.code === 0 || greeting) return { host, ok: true, message: `Authentication to ${host} succeeded.` }
  if (/permission denied|authentication failed/i.test(response)) {
    return { host, ok: false, message: `${host} did not accept this key.` }
  }
  return {
    host,
    ok: false,
    message: `Could not authenticate to ${host}. Check network access and whether the public key was added there.`,
  }
}

function view(record: SshKeyRecord) {
  return {
    ...record,
    createdAt: Math.floor(record.createdAt.getTime() / 1000),
  }
}

export class SshKeysService {
  private readonly repository: SshKeysRepository
  private readonly directory: string

  constructor(repository: SshKeysRepository, directory: string) {
    this.repository = repository
    this.directory = directory
  }

  private privatePath(id: string): string {
    return join(this.directory, id)
  }
  private publicPath(id: string): string {
    return join(this.directory, `${id}.pub`)
  }

  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
  }

  async list() {
    return { keys: (await this.repository.list()).map(view) }
  }

  private async refuseDuplicateName(name: string): Promise<void> {
    if ((await this.repository.list()).some((key) => key.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new SshKeyRefused(409, `an SSH key named '${name}' already exists`)
    }
  }

  async generate(input: { name: string; description?: string; algorithm: SshAlgorithm }) {
    await this.refuseDuplicateName(input.name)
    await this.prepare()
    const id = randomUUID()
    const privatePath = this.privatePath(id)
    const args =
      input.algorithm === 'rsa'
        ? ['-q', '-t', 'rsa', '-b', '4096', '-N', '', '-C', `portta:${id}`, '-f', privatePath]
        : ['-q', '-t', 'ed25519', '-N', '', '-C', `portta:${id}`, '-f', privatePath]
    try {
      const generated = await run('ssh-keygen', args)
      if (generated.code !== 0) throw new SshKeyRefused(400, 'the SSH key could not be generated')
      // ssh-keygen opens the private file safely; enforce the public mode too.
      await chmod(this.publicPath(id), 0o644)
      return await this.store(id, input, 'generated')
    } catch (error) {
      // This also covers a mode or metadata failure after ssh-keygen created
      // the private file, so a failed request cannot strand key material.
      await this.cleanup(id)
      throw error
    }
  }

  async import(input: { name: string; description?: string; privateKey: string }) {
    await this.refuseDuplicateName(input.name)
    await this.prepare()
    const id = randomUUID()
    const privatePath = this.privatePath(id)
    try {
      await writeFile(privatePath, input.privateKey.endsWith('\n') ? input.privateKey : `${input.privateKey}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
      const derived = await run('ssh-keygen', ['-y', '-f', privatePath])
      if (derived.code !== 0 || derived.stdout.trim() === '') {
        throw new SshKeyRefused(400, 'the private key must be a valid, unencrypted ED25519 or RSA SSH key')
      }
      parsePublicKey(derived.stdout)
      await writeFile(this.publicPath(id), `${derived.stdout.trim()} portta:${id}\n`, {
        encoding: 'utf8',
        mode: 0o644,
        flag: 'wx',
      })
      return await this.store(id, input, 'imported')
    } catch (error) {
      await this.cleanup(id)
      if (error instanceof SshKeyRefused) throw error
      throw new SshKeyRefused(400, 'the private key could not be imported')
    }
  }

  private async store(id: string, input: { name: string; description?: string }, origin: NewSshKeyRecord['origin']) {
    try {
      const publicKey = (await readFile(this.publicPath(id), 'utf8')).trim()
      const parsed = parsePublicKey(publicKey)
      const fingerprintResult = await run('ssh-keygen', ['-l', '-E', 'sha256', '-f', this.publicPath(id)])
      if (fingerprintResult.code !== 0) throw new SshKeyRefused(400, 'could not fingerprint the SSH key')
      const fingerprint = parseFingerprint(fingerprintResult.stdout)
      const created = await this.repository.create({
        id,
        name: input.name,
        description: input.description?.trim() || null,
        algorithm: parsed.algorithm,
        bits: parsed.algorithm === 'rsa' ? fingerprint.bits : null,
        fingerprint: fingerprint.fingerprint,
        publicKey,
        origin,
      })
      return view(created)
    } catch (error) {
      await this.cleanup(id)
      throw error
    }
  }

  async remove(id: string): Promise<SshKeyRecord> {
    const existing = await this.repository.find(id)
    if (!existing) throw new SshKeyRefused(404, `no SSH key '${id}'`)
    const privatePath = this.privatePath(id)
    const publicPath = this.publicPath(id)
    const stagedPrivate = `${privatePath}.deleting`
    const stagedPublic = `${publicPath}.deleting`
    try {
      await rename(privatePath, stagedPrivate)
      await rename(publicPath, stagedPublic)
      await this.repository.remove(id)
      await rm(stagedPrivate, { force: true })
      await rm(stagedPublic, { force: true })
      return existing
    } catch (error) {
      await rename(stagedPrivate, privatePath).catch(() => undefined)
      await rename(stagedPublic, publicPath).catch(() => undefined)
      throw error
    }
  }

  async test(id: string, host: SshForge): Promise<SshTestResult> {
    if (!FORGES.has(host)) throw new SshKeyRefused(400, 'that SSH forge is not supported')
    if (!(await this.repository.find(id))) throw new SshKeyRefused(404, `no SSH key '${id}'`)
    await this.prepare()
    const knownHosts = join(this.directory, 'known_hosts')
    await writeFile(knownHosts, forgeKnownHosts(host), { encoding: 'utf8', mode: 0o644 })
    const result = await run(
      'ssh',
      [
        '-T',
        `git@${host}`,
        '-o',
        'BatchMode=yes',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'GlobalKnownHostsFile=/dev/null',
        '-o',
        `UserKnownHostsFile=${knownHosts}`,
        '-i',
        this.privatePath(id),
      ],
      20_000,
    )
    return forgeTestResult(host, result)
  }

  private async cleanup(id: string): Promise<void> {
    await rm(this.privatePath(id), { force: true }).catch(() => undefined)
    await rm(this.publicPath(id), { force: true }).catch(() => undefined)
  }
}
