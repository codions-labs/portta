'use client'

import { useId } from 'react'
import type { ResourceTone } from '../lib/resources.ts'
import { cn } from '../lib/utils.ts'

const STROKE: Record<ResourceTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  neutral: 'text-subtle',
}

/**
 * The last few minutes of one measurement, small enough to sit beside the
 * number it belongs to.
 *
 * It answers one question — is this reading the shape of the last while, or a
 * spike — and nothing else. No axes, no grid, no tooltip: this is not
 * observability, and the moment it grows any of those it has become a chart
 * that belongs on a different page.
 *
 * Gaps matter. A collector that was not running leaves nulls, and drawing
 * through them would invent a measurement, so the line breaks instead.
 */
export function Sparkline({
  values,
  tone = 'neutral',
  /** Fix the top of the scale, for a ratio that means nothing rescaled to its own max. */
  max: fixedMax,
  label,
  className,
}: {
  values: ReadonlyArray<number | null>
  tone?: ResourceTone
  max?: number
  label?: string
  className?: string
}) {
  const gradient = useId()
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (finite.length < 2) return null

  const width = 120
  const height = 28
  const pad = 2
  const max = fixedMax ?? Math.max(...finite, 0.01)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const y = (value: number) => height - pad - (Math.min(value, max) / max) * (height - pad * 2)

  // One <polyline> per run of consecutive readings: a gap is a gap.
  const runs: string[] = []
  let run: string[] = []
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (run.length > 1) runs.push(run.join(' '))
      run = []
      return
    }
    run.push(`${(index * step).toFixed(1)},${y(value).toFixed(1)}`)
  })
  if (run.length > 1) runs.push(run.join(' '))
  if (runs.length === 0) return null

  const last = runs[runs.length - 1]!.split(' ')
  const area = `${runs[runs.length - 1]} ${last[last.length - 1]!.split(',')[0]},${height} ${last[0]!.split(',')[0]},${height}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('h-7 w-full', STROKE[tone], className)}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradient})`} stroke="none" />
      {runs.map((points, index) => (
        <polyline
          key={index}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}
