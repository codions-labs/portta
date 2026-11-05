import { nameIdentity, shortHash } from './name-digest.ts'

export function slug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '')
}

export function composeNamespace(base: string, suffix?: string | null): string {
  const joined = suffix ? `${slug(base)}-${slug(suffix)}` : slug(base)
  return joined.slice(0, 52).replace(/-$/, '') || 'project'
}

export function branchSuffix(branch: string): string | null {
  if (['main', 'master', 'develop', 'development'].includes(branch)) return null
  return slug(branch)
}

/** Generate only a new environment's identity; existing namespaces stay opaque. */
export function environmentNamespace(parts: { base: string; branch?: string | null; workspace: string }): string {
  const base = slug(parts.base)
  if (!base) throw new Error('the environment base has no namespace characters')
  if (!parts.workspace.trim()) throw new Error('the environment workspace is empty')
  const branch =
    parts.branch && !['main', 'master', 'develop', 'development'].includes(parts.branch) ? parts.branch : ''
  const identity = nameIdentity([parts.base, branch, parts.workspace])
  const suffix = branch ? slug(branch) || 'branch' : ''
  const repeated = suffix && (base === suffix || base.endsWith(`-${suffix}`))
  const readable = suffix && !repeated ? `${base}-${suffix}` : base
  return `${readable.slice(0, 43).replace(/-+$/, '')}-${shortHash(identity)}`
}
