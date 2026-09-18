import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { PERMISSIONS } from 'portta-auth-core/access-control'
import type { ReactElement, ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/client'
import type { Locale } from '@/lib/i18n/use-locale'
import { PrincipalProvider } from '@/lib/principal'
import type { PanelPrincipal } from '@/lib/server/principal-view'

const EVERYTHING: string[] = [...PERMISSIONS]

/**
 * Whoever a test does not say it is.
 *
 * The panel's own default: the local operator of a panel with
 * `PORTTA_AUTH_MODE=disabled`, holding everything. A test about what a role
 * cannot do passes its own principal.
 */
export const LOCAL_OPERATOR: PanelPrincipal = {
  kind: 'local',
  name: 'local',
  email: null,
  role: 'owner',
  actor: 'local',
  actorKind: 'human',
  // Deliberately not the real list: a test that needs a specific permission
  // hidden builds a principal that lacks it, and one that needs everything
  // should not have to enumerate seventy strings.
  permissions: EVERYTHING,
  scope: 'all',
}

export function principal(overrides: Partial<PanelPrincipal> = {}): PanelPrincipal {
  return { ...LOCAL_OPERATOR, ...overrides }
}

export function renderWithQuery(ui: ReactElement, locale?: Locale, who: PanelPrincipal = LOCAL_OPERATOR) {
  if (locale) void i18n.changeLanguage(locale)

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <PrincipalProvider principal={who}>{children}</PrincipalProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { ...render(ui, { wrapper }), client, i18n }
}
