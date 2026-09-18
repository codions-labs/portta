// Turning a Git remote into links, with nothing but string work.
//
// No network, no token, no API. Every forge follows a known shape, so a remote
// is enough to link the repository, a commit and a branch. A host nobody here
// recognises still gets its repository link and loses the other two, because a
// wrong link is worse than a missing one.
//
// Used twice: on a `portta.repo` label a project declared, and on the
// remote `portta repos scan` read. See
// docs/development/adr/0010-git-collected-on-the-host.md.

export type ForgeKind = 'github' | 'gitlab' | 'bitbucket' | 'unknown'

export interface Remote {
  /** The remote exactly as Git reports it, or the label as it was written. */
  url: string
  host: string
  /** `owner/name`, with any `.git` suffix and leading slash removed. */
  slug: string
  kind: ForgeKind
  repoUrl: string
}

function kindFor(host: string): ForgeKind {
  const lower = host.toLowerCase()
  if (lower === 'github.com' || lower.endsWith('.github.com') || lower.includes('github')) return 'github'
  if (lower.includes('gitlab')) return 'gitlab'
  if (lower.includes('bitbucket')) return 'bitbucket'
  return 'unknown'
}

function tidySlug(path: string): string {
  return path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
}

/**
 * Accepts what people actually have in `origin`, plus the bare `owner/name` a
 * project may write in a `portta.repo` label.
 */
export function parseRemote(raw: string): Remote | null {
  const value = raw.trim()
  if (value === '') return null

  // `owner/name`, with no host at all. GitHub is the only sensible default,
  // and a project that means something else writes the full URL.
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes(':')) {
    const slug = tidySlug(value)
    return { url: value, host: 'github.com', slug, kind: 'github', repoUrl: `https://github.com/${slug}` }
  }

  // scp-like: git@host:owner/name.git
  const scp = /^(?:([^@/]+)@)?([^:/]+):(?!\/)(.+)$/.exec(value)
  if (scp) {
    const host = scp[2] ?? ''
    const slug = tidySlug(scp[3] ?? '')
    if (host === '' || slug === '') return null
    return { url: value, host, slug, kind: kindFor(host), repoUrl: `https://${host}/${slug}` }
  }

  try {
    const parsed = new URL(value)
    const host = parsed.hostname
    // ssh://git@host:22/owner/name.git keeps the port in the URL and not in
    // the link a browser should follow.
    const slug = tidySlug(parsed.pathname)
    if (host === '' || slug === '') return null
    return { url: value, host, slug, kind: kindFor(host), repoUrl: `https://${host}/${slug}` }
  } catch {
    return null
  }
}

export function commitUrl(remote: Remote, sha: string): string | null {
  if (sha === '') return null
  switch (remote.kind) {
    case 'github':
    case 'gitlab':
      return `${remote.repoUrl}/commit/${sha}`
    case 'bitbucket':
      return `${remote.repoUrl}/commits/${sha}`
    default:
      return null
  }
}

export function branchUrl(remote: Remote, branch: string): string | null {
  if (branch === '') return null
  const encoded = branch.split('/').map(encodeURIComponent).join('/')
  switch (remote.kind) {
    case 'github':
      return `${remote.repoUrl}/tree/${encoded}`
    case 'gitlab':
      return `${remote.repoUrl}/-/tree/${encoded}`
    case 'bitbucket':
      return `${remote.repoUrl}/branch/${encoded}`
    default:
      return null
  }
}
