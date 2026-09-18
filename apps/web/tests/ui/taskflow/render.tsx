// Rendering a Taskflow component the way the panel mounts it: a query cache,
// the toasts, a principal, and a Taskflow Project whose API is a set of mocks.
//
// A test says what the daemon answers by stubbing the calls it cares about;
// every other call rejects, so a component that reaches for something the test
// did not expect fails loudly instead of waiting on a fetch that never lands.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render as renderReact } from '@testing-library/react'
import { type ComponentType, createElement, type ReactNode } from 'react'
import { type Mock, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/toast'
import { PrincipalProvider } from '@/lib/principal'
import type { PanelPrincipal } from '@/lib/server/principal-view'
import { createProjectApi, type ProjectApi } from '@/modules/taskflow/lib/api/index'
import { PreferencesProvider } from '@/modules/taskflow/lib/preferences'
import { TaskflowProjectProvider } from '@/modules/taskflow/lib/project'
import { LOCAL_OPERATOR } from '../render.tsx'

export const PROJECT = { slug: 'shop', projectId: '1', prefix: 'shop' } as const

type Fn = (...args: never[]) => unknown
export type FakeProjectApi = {
  [K in keyof ProjectApi]: ProjectApi[K] extends Fn ? Mock<ProjectApi[K]> & ProjectApi[K] : ProjectApi[K]
}

/** Every call of a Taskflow Project's API as a mock that rejects until a test says otherwise. */
export function fakeProjectApi(overrides: Partial<ProjectApi> = {}): FakeProjectApi {
  const real = createProjectApi(PROJECT.prefix)
  const fake: Record<string, unknown> = {
    prefix: PROJECT.prefix,
    socketUrl: (path: string) => `ws://localhost/ws/modules/taskflow/shop${path}`,
  }
  for (const [name, value] of Object.entries(real)) {
    if (typeof value !== 'function' || name === 'socketUrl') continue
    fake[name] = vi.fn(async () => {
      throw new Error(`${name} was not stubbed`)
    })
  }
  for (const [name, value] of Object.entries(overrides)) {
    fake[name] = typeof value === 'function' ? vi.fn(value as Fn) : value
  }
  return fake as FakeProjectApi
}

/** A fresh cache per render, never retrying, so one test's data never reaches the next. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

export interface RenderOptions {
  api?: FakeProjectApi
  principal?: PanelPrincipal
}

function withProviders(
  client: QueryClient,
  api: FakeProjectApi,
  principal: PanelPrincipal,
  node: ReactNode,
): ReactNode {
  return (
    <QueryClientProvider client={client}>
      <PrincipalProvider principal={principal}>
        <ToastProvider>
          <TaskflowProjectProvider slug={PROJECT.slug} projectId={PROJECT.projectId} api={api as unknown as ProjectApi}>
            <PreferencesProvider>{node}</PreferencesProvider>
          </TaskflowProjectProvider>
        </ToastProvider>
      </PrincipalProvider>
    </QueryClientProvider>
  )
}

export function render<Props extends object>(
  Component: ComponentType<Props>,
  input?: Props | { props: Props },
  options: RenderOptions = {},
) {
  const props = input && 'props' in input ? input.props : input
  const client = createTestQueryClient()
  const api = options.api ?? fakeProjectApi()
  const principal = options.principal ?? LOCAL_OPERATOR
  const element = (next?: Props) =>
    withProviders(client, api, principal, createElement(Component, (next ?? props) as Props))
  const result = renderReact(element())
  return {
    ...result,
    api,
    queryClient: client,
    rerender: async (nextProps: Props): Promise<void> => {
      result.rerender(element(nextProps))
    },
  }
}

/** Radix menus open on pointer down, not click; this is the press a real mouse makes. */
export function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
}

export { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
