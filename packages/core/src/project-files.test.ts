import { describe, expect, it } from 'vitest'
import { fileKey, isFileEnvironmentName, isSafeRelativePath, isSecretPath } from './project-files.ts'

describe('what is shown of a project’s files', () => {
  it.each([
    '.env',
    '.env.production',
    'api/.env.local',
    'deploy/server.pem',
    'keys/id_rsa',
    '.ssh/config',
    'infra/terraform.tfstate',
    'prod.tfvars',
    '.npmrc',
    'config/credentials.json',
    'secrets.yaml',
    'prod.env',
    '.env-production',
    '.env_prod',
    'app/Secrets/keys.txt',
    'config/CREDENTIALS.yml',
    'db/password.txt',
    'gcp-service-account.json',
    'vpn/client.ovpn',
    '.pgpass',
    '.Env',
  ])('keeps %s to itself', (path) => {
    expect(isSecretPath(path)).toBe(true)
  })

  it.each(['.env.example', 'api/.env.sample', 'src/app.ts', 'README.md', 'keyboard.ts', 'docs/guide.md'])(
    'shows %s',
    (path) => {
      expect(isSecretPath(path)).toBe(false)
    },
  )

  it('refuses a path that leaves the folder, however it is written', () => {
    for (const path of ['../etc/passwd', 'a/../../b', '/etc/passwd', 'a//b', './a', 'a\\b', 'a\0b', '']) {
      expect(isSafeRelativePath(path)).toBe(false)
    }
    expect(isSafeRelativePath('src/cart/validate.ts')).toBe(true)
  })

  it('names a blob from the path alone, so the panel never builds a file name from a request', () => {
    expect(fileKey('src/app.ts')).toMatch(/^[0-9a-f]{64}$/)
    expect(fileKey('src/app.ts')).not.toBe(fileKey('src/App.ts'))
  })

  it('accepts an environment name that is a folder name, and nothing that climbs', () => {
    expect(isFileEnvironmentName('demo-shop_issue.312')).toBe(true)
    for (const name of ['..', '.hidden', 'a/b', '', 'a b']) expect(isFileEnvironmentName(name)).toBe(false)
  })
})
