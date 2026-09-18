// Which Taskflow Project a Portta Project is.
//
// The same rule the panel's proxy scopes requests by
// (packages/server/src/modules/taskflow/scope.ts): a Taskflow Project is the
// Portta Project whose directory, or one of whose repositories' directories,
// is the one Taskflow serves. The server hands the page those directories.

function normalized(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export function findTaskflowProject<P extends { prefix: string; path: string }>(
  projects: readonly P[],
  hostPaths: readonly string[],
): P | null {
  const wanted = new Set(hostPaths.map(normalized))
  return projects.find((project) => wanted.has(normalized(project.path))) ?? null
}
