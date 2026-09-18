import type { InputHTMLAttributes } from 'react'
import { cn } from '../lib-utils.ts'

/**
 * The login page's text input: a deliberate copy of the panel's Input
 * (apps/web/components/ui/field.tsx), because this app is a separate Vite build
 * that may not import from the panel.
 *
 * One border colour at rest, a stronger one on hover, the accent on focus and
 * danger when invalid: the same four states on every control, so a form reads
 * as one thing. `aria-invalid` is the only way to say a value is wrong; the
 * control never guesses.
 */
const control = [
  'w-full min-w-0 rounded-md border border-line bg-surface text-ink',
  'placeholder:text-faint transition-colors duration-100',
  'hover:border-line-strong',
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
  'read-only:bg-surface-2 read-only:hover:border-line',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line',
  'aria-invalid:border-danger aria-invalid:focus:ring-danger/25',
].join(' ')

const heights = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-2.5 text-sm',
} as const

export type FieldSize = keyof typeof heights

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: FieldSize
  /** For paths, hashes, ports: what a person will paste from a terminal. */
  mono?: boolean
}

export function Input({ className, size = 'md', mono = false, ...props }: InputProps) {
  return <input className={cn(control, heights[size], mono && 'font-mono', className)} {...props} />
}
