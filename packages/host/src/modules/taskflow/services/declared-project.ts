import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultProjectConfig, PROJECT_CONFIG_PATH, type ProjectConfig, parseProjectConfig } from 'portta-core'
import { parse as parseYaml } from 'yaml'

/** What `.portta/project.yaml` says, or the same defaults a missing file gets. */
export function readDeclaredProjectConfig(projectRoot: string): ProjectConfig {
  const path = join(projectRoot, PROJECT_CONFIG_PATH)
  if (!existsSync(path)) return defaultProjectConfig()
  try {
    const parsed = parseProjectConfig(parseYaml(readFileSync(path, 'utf8')))
    return parsed.ok ? parsed.config : defaultProjectConfig()
  } catch {
    return defaultProjectConfig()
  }
}
