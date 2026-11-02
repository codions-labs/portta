'use client'

import { CopyButton } from '@/components/copy'

export function CommandLine({ value }: { value: string }) {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-terminal py-1 pr-1 pl-3 text-terminal-fg">
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
        {value}
      </span>
      <CopyButton value={value} className="text-terminal-dim hover:text-terminal-fg" />
    </span>
  )
}
