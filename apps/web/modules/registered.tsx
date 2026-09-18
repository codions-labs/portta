'use client'

// Which modules this panel carries, for the widgets that list them.
//
// The layout resolves the ids on the server and passes them down once, the way
// it passes the principal. Unlike the principal, a missing provider is an
// answer rather than a bug: no modules, which is what a panel without any is.

import { createContext, type ReactNode, useContext, useMemo } from 'react'

const ModulesContext = createContext<ReadonlySet<string>>(new Set())

export function ModulesProvider({ ids, children }: { ids: readonly string[]; children: ReactNode }) {
  const value = useMemo(() => new Set(ids), [ids])
  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>
}

export function useModules(): ReadonlySet<string> {
  return useContext(ModulesContext)
}
