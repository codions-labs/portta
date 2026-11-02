// What the auth pages share: the mark, a card, and the two layouts around it.
// Signing in and creating the owner say what the panel is beside the card; the
// second factor is one card, because nobody needs to be told anything there.

import type { ReactNode } from 'react'

export function Brand({ centered = false }: { centered?: boolean }) {
  return (
    <div className={`flex items-center gap-3 font-heading text-2xl font-bold ${centered ? 'justify-center' : ''}`}>
      <span aria-hidden className="grid size-10 place-items-center rounded-[0.625rem] bg-accent text-accent-fg">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <path d="M4 11.5V6" />
          <path d="M8 11.5V3.5" />
          <path d="M12 11.5V8" />
        </svg>
      </span>
      Portta
    </div>
  )
}

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-6 shadow-raised">
      <h1 className="font-heading text-[1.375rem] leading-tight font-semibold text-ink">{title}</h1>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  )
}

/** Beside the card, what this is. Stacks above it on a phone. */
export function AuthSplit({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-10">
      <div className="flex min-w-0 flex-[11_1_26rem] flex-col gap-5 [&>*]:min-w-0">{hero}</div>
      <div className="min-w-0 flex-[9_1_21rem]">{children}</div>
    </div>
  )
}

export function AuthSingle({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-105 flex-col gap-4">
      <Brand centered />
      {children}
      {footer}
    </div>
  )
}
