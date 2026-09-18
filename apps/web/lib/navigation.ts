'use client'

// Going somewhere, from code rather than from a link.
//
// Next owns routing, and a component inside a page should
// use `useRouter()` — a client-side transition that keeps the query cache, the
// scroll position and the open dialog.
//
// This is for the handful of places that navigate outside a component's render
// (a menu action or a keyboard handler in a module). It is a real navigation,
// not a transition.

export function navigate(path: string): void {
  if (typeof window === 'undefined') return
  window.location.assign(path)
}
