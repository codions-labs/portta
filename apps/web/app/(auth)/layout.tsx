// The pages you can reach before you are anybody.
//
// Deliberately outside the shell: there is no navigation to offer somebody who
// has not signed in, and rendering a rail full of links that all redirect back
// here would be a worse answer than a card on an empty page.

import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}
