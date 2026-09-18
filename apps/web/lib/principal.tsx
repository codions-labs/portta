'use client'

// Who the page was rendered for, available to the widgets inside it.
//
// The layout resolves the principal on the server and passes it down once. A
// client component never fetches it: the answer would arrive after the first
// paint, and a control that appears a moment later is worse than one that was
// always there or never was.

import { createContext, type ReactNode, useContext } from 'react'
import type { PanelPrincipal } from '@/lib/server/principal-view'

const PrincipalContext = createContext<PanelPrincipal | null>(null)

export function PrincipalProvider({ principal, children }: { principal: PanelPrincipal; children: ReactNode }) {
  return <PrincipalContext.Provider value={principal}>{children}</PrincipalContext.Provider>
}

export function usePrincipal(): PanelPrincipal {
  const principal = useContext(PrincipalContext)
  // Every panel page is inside `(panel)/layout.tsx`, which provides one. A
  // component reaching this outside that tree is a bug in the tree, not a
  // reason to invent an anonymous principal that might be allowed something.
  if (!principal) throw new Error('usePrincipal was called outside the panel layout')
  return principal
}
