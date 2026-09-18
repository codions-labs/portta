'use client'

import { cn } from '../../lib/utils.ts'

interface PaneBarProps {
  activePane: number
  panes: { index: number; label: string }[]
  onSelect: (pane: number) => void
}

export function PaneBar({ activePane, panes, onSelect }: PaneBarProps) {
  return (
    <nav className="pane-bar flex items-stretch border-t border-line bg-surface">
      {panes.map((pane) => (
        <button
          key={pane.index}
          type="button"
          className={cn(
            'relative flex-1 py-3 text-sm font-medium transition-colors duration-100 focus-ring-inset',
            'before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded-full',
            activePane === pane.index ? 'text-ink before:bg-accent' : 'text-subtle hover:text-ink',
          )}
          onClick={() => onSelect(pane.index)}
        >
          {pane.label}
        </button>
      ))}
    </nav>
  )
}
