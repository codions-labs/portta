import { cn } from '../lib/utils.ts'

export function GatewayStatusDot({
  up,
  pending,
  title,
  className,
}: {
  up: boolean | undefined
  pending: boolean
  title: string
  className?: string
}) {
  return (
    <span
      className={cn('size-2 shrink-0 rounded-full', up ? 'bg-ok' : pending ? 'bg-subtle' : 'bg-danger', className)}
      title={title}
      aria-hidden
    />
  )
}
