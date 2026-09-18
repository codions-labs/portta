#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { arch } from 'node:os'

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  const value = `${result.stdout}\n${result.stderr}`
  return value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
}

function osRelease() {
  return Object.fromEntries(
    readFileSync('/etc/os-release', 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')]
      }),
  )
}

const chromium = execFileSync(
  'find',
  [
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/ms-playwright',
    '-type',
    'f',
    '(',
    '-name',
    'chrome-headless-shell',
    '-o',
    '-name',
    'headless_shell',
    ')',
    '-executable',
    '-print',
    '-quit',
  ],
  { encoding: 'utf8' },
).trim()

if (!chromium) throw new Error('Playwright Chromium executable was not found')

const os = osRelease()
const manifest = {
  schemaVersion: 1,
  sandbox: {
    version: process.env.SANDBOX_VERSION ?? 'unknown',
    builtAt: process.env.BUILD_DATE ?? 'unknown',
    buildId: process.env.BUILD_ID ?? 'local',
    gitRevision: process.env.VCS_REF ?? 'unknown',
    platform: `linux/${arch() === 'x64' ? 'amd64' : arch()}`,
    base: `${os.PRETTY_NAME ?? os.ID ?? 'Linux'}`,
  },
  tools: {
    node: output('node', ['--version']),
    npm: output('npm', ['--version']),
    git: output('git', ['--version']),
    gh: output('gh', ['--version']),
    aws: output('aws', ['--version']),
    codex: output('codex', ['--version']),
    claude: output('claude', ['--version']),
    opencode: output('opencode', ['--version']),
    pi: output('pi', ['--version']),
    playwright: output('playwright', ['--version']),
    chromium: output(chromium, ['--version', '--no-sandbox']),
    mermaid: output('mmdc', ['--version']),
    asciinema: output('asciinema', ['--version']),
  },
}

writeFileSync(process.argv[2] ?? '/etc/portta-sandbox/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
