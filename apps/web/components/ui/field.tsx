'use client'

import { Check, ChevronDown, Minus } from 'lucide-react'
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'
import { cn } from '../../lib/utils.ts'

/**
 * Form controls.
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

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: FieldSize
}

/**
 * A native select with the panel's chevron. The className sizes the box, so
 * `w-40` or `h-7` on the outside behaves the way it does on an Input.
 */
export function Select({ className, size = 'md', children, ...props }: SelectProps) {
  return (
    <span className={cn('relative inline-block', size === 'sm' ? 'h-7' : 'h-8', className)}>
      <select
        className={cn(control, 'h-full appearance-none pr-7', size === 'sm' ? 'px-2 text-xs' : 'px-2.5 text-sm')}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-subtle"
      />
    </span>
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean
}

export function Textarea({ className, mono = false, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(control, 'px-2.5 py-1.5 text-sm leading-relaxed', mono && 'font-mono text-xs', className)}
      {...props}
    />
  )
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  indeterminate?: boolean
}

/**
 * A checkbox that looks the same in both themes and every browser. The native
 * input does the work — keyboard, forms, `indeterminate` — and the box on top
 * only paints.
 */
export function Checkbox({ className, indeterminate = false, ...props }: CheckboxProps) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0 align-middle', className)}>
      <input
        type="checkbox"
        ref={(node) => {
          if (node) node.indeterminate = indeterminate
        }}
        className={cn(
          'peer size-4 cursor-pointer appearance-none rounded-sm border border-line-strong bg-surface',
          'transition-colors duration-100 hover:border-subtle',
          'checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-accent-fg opacity-0 peer-checked:opacity-100"
      />
      <Minus
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-accent-fg opacity-0 peer-indeterminate:opacity-100"
      />
    </span>
  )
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: the caller supplies the control, through htmlFor or as children
  return <label className={cn('text-xs font-medium text-muted', className)} {...props} />
}

/**
 * A control with its name, its explanation and, when there is one, its error.
 *
 * The label is always a real `<label>` bound to the control, so clicking the
 * name focuses the field and a screen reader announces both together.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  id,
  className,
  children,
  inline = false,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  /** Forwarded to the control by the caller: `<Field id="x"><Input id="x"/></Field>`. Generated when absent. */
  id?: string
  className?: string
  children: ReactNode | ((id: string) => ReactNode)
  /** Label to the left, control to the right: a settings row. */
  inline?: boolean
}) {
  const generated = useId()
  const controlId = id ?? generated
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  return (
    <div className={cn(inline ? 'flex items-start justify-between gap-4' : 'grid gap-1', className)}>
      <div className={cn('min-w-0', inline && 'flex-1')}>
        <Label htmlFor={controlId} className="block">
          {label}
          {required ? (
            <span aria-hidden className="ml-0.5 text-danger">
              *
            </span>
          ) : null}
        </Label>
        {inline && hint ? (
          <p id={hintId} className="mt-0.5 text-xs text-subtle">
            {hint}
          </p>
        ) : null}
      </div>
      <div className={cn('min-w-0', inline && 'shrink-0')}>
        {typeof children === 'function' ? children(controlId) : children}
        {!inline && hint ? (
          <p id={hintId} className="mt-1 text-xs text-subtle">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
