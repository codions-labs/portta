import packageMetadata from '../package.json' with { type: 'json' }

declare const __PORTTA_BUILD_DATE__: string | undefined

export const CLI_VERSION = packageMetadata.version

/** When the bundle was built; undefined when running from source. */
export const CLI_BUILD_DATE: string | undefined =
  typeof __PORTTA_BUILD_DATE__ === 'string' ? __PORTTA_BUILD_DATE__ : undefined

export function cliVersionLine(): string {
  return `portta ${CLI_VERSION}${CLI_BUILD_DATE ? ` (built ${CLI_BUILD_DATE})` : ''}`
}
