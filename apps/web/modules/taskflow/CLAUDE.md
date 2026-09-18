# Taskflow in the panel

The pages of the Taskflow module: worktrees, terminals, agent chat, Runs,
workflows and their settings. Its runtime is the host daemon; the panel reaches
it through the proxy in `packages/server/src/modules/taskflow`, at the same paths.

## Where things go

- **`index.ts`**: `taskflowWebModule` — the rail entry, the Project tabs, the
  Settings section and the translation namespaces. Nothing outside this
  directory imports anything else from it except the App Router files.
- **`containers/`**: one client component per page. The route files under
  `app/(panel)/projects/[slug]/(taskflow)`, `app/(panel)/taskflow` and
  `app/(panel)/settings/taskflow` stay thin: they check the module switch and the
  permission, resolve what only the server can, and render a container.
- **`components/workspace/`**: the project gate (a Portta Project to its Taskflow
  prefix, or the action that adds it) and the frame every Project page shares.
- **`components/<area>`**: views and dialogs per area. Primitives come from
  `@/components/ui/*` and `@/components/shell-bits`; do not copy them here.
- **`lib/api/*`**: every call to the daemon, bound to a prefix by
  `createProjectApi`. Components reach it through `useTaskflowProject()` and never
  call `fetch` themselves; a test passes a fake API to the provider.
- **`lib/queries/*`**: React Query hooks. Keys come from `taskflowKeys(prefix)`,
  so two Projects never share a cache entry. `lib/live.ts` turns the daemon's
  streams into invalidations; do not add ad-hoc polling.
- **`lib/navigation.ts`**: hrefs (`taskflowPaths(slug)`) and which page a path is.
- **`lib/types.ts`**: shared interfaces, re-exported from the contract.

## Rules

- Offer an action only to somebody who may take it: `useTaskflowCan(permission)`
  is scoped to the Project. The proxy decides again on every request.
- Every user-facing string goes through `react-i18next` in the `taskflow`,
  `taskflow-worktrees` or `taskflow-runs` namespace, with the key in both
  `messages/en` and `messages/pt-BR`. Shared words (`save`, `cancel`) come from
  Portta's `common`. Prompts sent to agents stay in English.
- Tokens and components follow [the design system](../../../../docs/development/design-system.md). Taskflow-only CSS (the terminal, the
  diff viewer) lives in `styles.css`, imported by the Taskflow layout.
- Tests live in `apps/web/tests/ui/taskflow` and `apps/web/tests/logic/taskflow`.
