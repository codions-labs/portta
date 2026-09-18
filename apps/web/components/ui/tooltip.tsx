'use client'

import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils.ts'
import { Shortcut } from './kbd.tsx'

type Side = 'top' | 'bottom' | 'left' | 'right'

/**
 * A label for something whose icon or colour is not self-explanatory.
 *
 * Written here rather than pulled in as another Radix package: a tooltip is a
 * positioned box with `aria-describedby`, and the whole of it fits on one
 * screen. It appears on hover and on keyboard focus — an icon button that only
 * explains itself to a mouse explains itself to nobody — and leaves on Escape.
 * It stays inside the viewport: a tooltip at the edge slides in rather than
 * out.
 *
 * It is never the only place a meaning lives. If a control needs a tooltip to
 * be usable at all, the control is wrong.
 */
export function Tooltip({
  label,
  shortcut,
  children,
  side = 'top',
  delay = 300,
}: {
  label: ReactNode
  /** Shown beside the label as keys. */
  shortcut?: readonly string[]
  /** A single element that can take a ref and the pointer/focus handlers. */
  children: ReactElement<Record<string, unknown>>
  side?: Side
  delay?: number
}) {
  const id = useId()
  const anchor = useRef<HTMLElement | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setOpen(false)
    setPosition(null)
  }, [])

  const show = useCallback(
    (immediate = false) => {
      if (timer.current) clearTimeout(timer.current)
      if (immediate) setOpen(true)
      else timer.current = setTimeout(() => setOpen(true), delay)
    },
    [delay],
  )

  // Placed after the box exists, so its real size can be kept on screen.
  useLayoutEffect(() => {
    if (!open) return
    const element = anchor.current
    const tip = box.current
    if (!element || !tip) return
    const rect = element.getBoundingClientRect()
    const size = tip.getBoundingClientRect()
    const gap = 6
    const pad = 8
    let top: number
    let left: number
    if (side === 'bottom') {
      top = rect.bottom + gap
      left = rect.left + rect.width / 2 - size.width / 2
    } else if (side === 'left') {
      top = rect.top + rect.height / 2 - size.height / 2
      left = rect.left - gap - size.width
    } else if (side === 'right') {
      top = rect.top + rect.height / 2 - size.height / 2
      left = rect.right + gap
    } else {
      top = rect.top - gap - size.height
      left = rect.left + rect.width / 2 - size.width / 2
    }
    if (side === 'top' && top < pad) top = rect.bottom + gap
    if (side === 'bottom' && top + size.height > window.innerHeight - pad) top = rect.top - gap - size.height
    left = Math.min(Math.max(pad, left), window.innerWidth - pad - size.width)
    top = Math.min(Math.max(pad, top), window.innerHeight - pad - size.height)
    setPosition({ top, left })
  }, [open, side])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchor.current = node
      const forwarded = (children as unknown as { ref?: unknown }).ref
      if (typeof forwarded === 'function') forwarded(node)
      else if (forwarded && typeof forwarded === 'object') (forwarded as { current: unknown }).current = node
    },
    'aria-describedby': open ? id : undefined,
    onPointerEnter: () => show(),
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: () => show(true),
    onBlur: hide,
  })

  return (
    <>
      {trigger}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={box}
              id={id}
              role="tooltip"
              style={position ? { top: position.top, left: position.left } : { top: -9999, left: -9999 }}
              className={cn(
                'pointer-events-none fixed z-[70] flex max-w-xs items-center gap-2 rounded-md px-2 py-1',
                'bg-tooltip text-xs leading-snug text-tooltip-fg shadow-overlay',
                position && 'animate-fade-in',
              )}
            >
              <span>{label}</span>
              {shortcut ? (
                <Shortcut
                  keys={shortcut}
                  className="[&_kbd]:border-tooltip-fg/20 [&_kbd]:bg-tooltip-fg/10 [&_kbd]:text-tooltip-fg/80"
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
