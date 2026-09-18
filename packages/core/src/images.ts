const RELEASE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/

export interface PorttaImages {
  runtime: string
  apply: string
  toolbox: string
}

export function assertReleaseVersion(version: string): string {
  const value = version.trim()
  if (!RELEASE_VERSION.test(value)) throw new Error(`invalid Portta release version '${value || '<empty>'}'`)
  return value
}

/** Local release artefacts. Published installs use the GHCR image in Compose. */
export function porttaImages(version: string): PorttaImages {
  const release = assertReleaseVersion(version)
  return {
    runtime: `codions-labs/portta:${release}`,
    apply: `codions-labs/portta-apply:${release}`,
    toolbox: `codions-labs/portta-toolbox:${release}`,
  }
}
