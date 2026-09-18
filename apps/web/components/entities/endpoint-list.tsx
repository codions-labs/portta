import type { RouteUrl } from 'portta-contracts'
import { orderEndpoints } from '../../lib/endpoints.ts'
import { cn } from '../../lib/utils.ts'
import { AddressLine } from '../copy.tsx'
import { ScopeBadge } from '../status.tsx'

/**
 * The addresses a service answers on, nearest first. One list, one order,
 * wherever a URL is shown; the scope badge is dropped when there is only one
 * address, because a badge that cannot differ says nothing.
 */
export function EndpointList({
  endpoints,
  compact = false,
  limit,
  className,
}: {
  endpoints: readonly RouteUrl[]
  compact?: boolean
  limit?: number
  className?: string
}) {
  const ordered = orderEndpoints(endpoints)
  const shown = limit ? ordered.slice(0, limit) : ordered
  if (shown.length === 0) return null
  return (
    <ul className={cn(compact ? 'space-y-0.5' : 'space-y-1', className)}>
      {shown.map((endpoint) => (
        <li key={endpoint.url} className="flex min-w-0 items-center gap-1.5">
          {shown.length > 1 || !compact ? <ScopeBadge scope={endpoint.scope} /> : null}
          <AddressLine className="min-w-0 flex-1" value={endpoint.url} href={endpoint.url} />
        </li>
      ))}
    </ul>
  )
}
