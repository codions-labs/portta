export const MIN_NODE_MAJOR = 24

export function parseNodeMajor(version: string): number | null {
  const match = /^v?(\d+)/.exec(version.trim())
  if (!match?.[1]) return null
  const major = Number.parseInt(match[1], 10)
  return Number.isFinite(major) ? major : null
}

export function isSupportedNodeVersion(version: string, minMajor = MIN_NODE_MAJOR): boolean {
  const major = parseNodeMajor(version)
  return major !== null && major >= minMajor
}
