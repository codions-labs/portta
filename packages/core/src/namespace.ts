export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
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
