// Files the module reads at runtime that are not code: the builtin workflows and
// the workflow authoring skill.
//
// Bundled, they sit in `assets/` beside the bundle that imports this (the CLI's
// `dist/cli.js` and the daemon's `dist/host.js` share one `dist/`). From source
// they are where the repository keeps them.

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ENV_NAMES } from 'portta-core/taskflow/config'

export interface TaskflowAssets {
  workflowBuiltinsDir: string
  workflowSkill: string
}

export function taskflowAssets(
  env: Readonly<Record<string, string | undefined>> = process.env,
  directory: string = import.meta.dirname,
): TaskflowAssets {
  const bundled = join(directory, 'assets')
  if (existsSync(join(bundled, 'workflows'))) {
    return {
      workflowBuiltinsDir: env[ENV_NAMES.workflowBuiltinsDir] || join(bundled, 'workflows'),
      workflowSkill: join(bundled, 'skills', 'portta-workflows', 'SKILL.md'),
    }
  }
  const repository = resolve(directory, '../../../../..')
  return {
    workflowBuiltinsDir: env[ENV_NAMES.workflowBuiltinsDir] || join(repository, 'packages', 'host', 'workflows'),
    workflowSkill: join(repository, 'skills', 'portta-workflows', 'SKILL.md'),
  }
}
