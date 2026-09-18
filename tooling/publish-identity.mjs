import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STABLE_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA = /^[0-9a-f]{7,64}$/i
const RUN = /^[1-9]\d*$/

function required(value, label) {
  if (!value) throw new Error(`${label} is required`)
  return value
}

function developmentIdentity(branch, runNumber, sha) {
  const channel = branch === 'develop' ? 'develop' : branch === 'main' ? 'next' : null
  if (!channel) throw new Error(`unsupported publication branch: ${branch}`)
  if (!RUN.test(required(runNumber, 'GitHub run number'))) throw new Error(`invalid GitHub run number: ${runNumber}`)
  if (!SHA.test(required(sha, 'Git commit SHA'))) throw new Error(`invalid Git commit SHA: ${sha}`)
  const shortSha = sha.slice(0, 7).toLowerCase()
  return {
    version: `0.0.0-${channel}.${runNumber}.sha-${shortSha}`,
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

export function bootstrapIdentity(sha, now = new Date()) {
  if (!SHA.test(required(sha, 'Git commit SHA'))) throw new Error(`invalid Git commit SHA: ${sha}`)
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new Error('invalid bootstrap timestamp')
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('')
  return { version: `0.0.0-develop.${stamp}.sha-${sha.slice(0, 7).toLowerCase()}`, channel: 'develop', npmTag: 'dev' }
}

export function resolvePublication({ eventName, refName, releaseTag, sha, runNumber }) {
  if (eventName === 'release') return releaseIdentity(releaseTag)
  if (eventName === 'push') return developmentIdentity(required(refName, 'Git branch'), runNumber, sha)
  throw new Error(`unsupported publication event: ${eventName}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = resolvePublication({
    eventName: process.env.EVENT_NAME,
    refName: process.env.REF_NAME,
    releaseTag: process.env.RELEASE_TAG,
    sha: process.env.SHA,
    runNumber: process.env.RUN_NUMBER,
  })
  process.stdout.write(
    `${Object.entries(identity)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  )
}
