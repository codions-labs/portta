// The pages you can reach before you are anybody.
//
// Deliberately outside the shell: there is no navigation to offer somebody who
// has not signed in, and rendering a rail full of links that all redirect back
// here would be a worse answer than a card on an empty page.

import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-dvh grid-cols-[minmax(0,1fr)] place-items-center overflow-hidden bg-bg bg-gradient-to-b from-bg via-bg to-surface-2 px-5 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-[45%] size-72 rounded-full bg-link/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 -right-16 size-64 rounded-full bg-ok/12 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-16 size-72 rounded-full bg-warn/12 blur-3xl"
      />
      <div className="relative z-10 w-full min-w-0">{children}</div>
    </main>
  )
}
