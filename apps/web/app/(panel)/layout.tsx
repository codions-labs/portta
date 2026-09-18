import { redirect } from 'next/navigation'
import { hasOwner } from 'portta-auth-core'
import type { ReactNode } from 'react'
import { Shell } from '@/components/shell/shell'
import { PrincipalProvider } from '@/lib/principal'
import { serverDeps } from '@/lib/server/deps'
import { registeredModuleIds } from '@/lib/server/modules'
import { getPrincipal } from '@/lib/server/principal'
import { panelPrincipal } from '@/lib/server/principal-view'
import { ModulesProvider } from '@/modules/registered'

/**
 * Every panel page is rendered inside the shell, and behind this check.
 *
 * A Server Component that renders one client boundary: the shell is
 * interactive — a palette, a theme menu, a live connection — and the pages
 * inside it are not, so the boundary sits here rather than around each page.
 *
 * It is also the one entrance every page comes through, which is why
 * authentication is decided here rather than in a proxy: a proxy would run on
 * every asset, could not reach the database, and would answer a question this
 * already answers once per render.
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const deps = serverDeps()
  // A panel with no owner has one page, and it is not this one.
  if (deps.security.mode === 'protected' && !(await hasOwner(deps.db.handle))) redirect('/setup')

  const principal = await getPrincipal()
  if (!principal) redirect('/sign-in')

  return (
    <PrincipalProvider principal={panelPrincipal(principal)}>
      <ModulesProvider ids={registeredModuleIds()}>
        <Shell>{children}</Shell>
      </ModulesProvider>
    </PrincipalProvider>
  )
}
