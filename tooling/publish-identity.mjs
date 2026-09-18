import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STABLE_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA = /^[0-9a-f]{7,64}$/i

function required(value, label) {
  if (!value) throw new Error(`${label} is required`)
  return value
}

// A UTC stamp, not the workflow run number: recreating the repository restarts
// `github.run_number` and would publish versions that sort below the ones npm
// already holds.
function stamp(now) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new Error('invalid publication timestamp')
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('')
}

export function developmentIdentity(branch, sha, now = new Date()) {
  const channel = branch === 'develop' ? 'develop' : branch === 'main' ? 'next' : null
  if (!channel) throw new Error(`unsupported publication branch: ${branch}`)
  if (!SHA.test(required(sha, 'Git commit SHA'))) throw new Error(`invalid Git commit SHA: ${sha}`)
  const shortSha = sha.slice(0, 7).toLowerCase()
  return {
    version: `0.0.0-${channel}.${stamp(now)}.sha-${shortSha}`,
    channel,
    npmTag: channel === 'develop' ? 'dev' : 'next',
    ref: sha,
  }
}

export function releaseIdentity(tag) {
  const matched = STABLE_RELEASE_TAG.exec(required(tag, 'GitHub Release tag'))
  if (!matched) throw new Error(`GitHub Release tag must be a stable vX.Y.Z version: ${tag}`)
  return { version: tag.slice(1), channel: 'release', npmTag: 'latest', ref: tag }
}

// The bootstrap publishes from a local worktree, so it has no ref to hand back.
export function bootstrapIdentity(sha, now = new Date()) {
  const { ref, ...identity } = developmentIdentity('develop', sha, now)
  return identity
}

export function resolvePublication({ eventName, refName, releaseTag, sha, now = new Date() }) {
  if (eventName === 'release') return releaseIdentity(releaseTag)
  if (eventName === 'push') return developmentIdentity(required(refName, 'Git branch'), sha, now)
  throw new Error(`unsupported publication event: ${eventName}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = resolvePublication({
    eventName: process.env.EVENT_NAME,
    refName: process.env.REF_NAME,
    releaseTag: process.env.RELEASE_TAG,
    sha: process.env.SHA,
  })
  process.stdout.write(
    `${Object.entries(identity)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  )
}
