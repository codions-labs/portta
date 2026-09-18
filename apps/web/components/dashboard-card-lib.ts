export function primaryUsable<T extends { usable: boolean; scope: string }>(endpoints: T[]): T | null {
  return endpoints.find((entry) => entry.usable && entry.scope !== 'internal') ?? null
}
