// The frame the three auth pages share: a mark, a title, a sentence, a form.

import type { ReactNode } from 'react'

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-6 shadow-sm">
      <span aria-hidden className="mb-5 flex size-8 items-center justify-center rounded-md bg-accent text-accent-fg">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4"
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
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  )
}
