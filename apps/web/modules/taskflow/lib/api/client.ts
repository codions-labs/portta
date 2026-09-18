// Where the panel serves Taskflow, and the clients every module under lib/api/
// builds on. The request and response shapes come from `createApi` in
// portta-contracts/taskflow.
//
// The panel forwards the host daemon's routes one to one, behind Portta's
// permissions (packages/server/src/modules/taskflow): the registry at the
// module root, and everything else under a Taskflow Project's prefix.

import { type ApiClient, createApi } from 'portta-contracts/taskflow'

export const TASKFLOW_API_ROOT = '/api/modules/taskflow'
export const TASKFLOW_WS_ROOT = '/ws/modules/taskflow'

export interface TaskflowClient {
  /** The Taskflow Project's prefix, which is also its id in Run routes. */
  prefix: string
  /** `/api/modules/taskflow/<prefix>`: the base of every Project route. */
  base: string
  contract: ApiClient
  /** A WebSocket URL on this origin for a Project socket such as `/ws/<worktree>`. */
  socketUrl: (path: string) => string
}

export function taskflowClient(prefix: string): TaskflowClient {
  const segment = encodeURIComponent(prefix)
  const base = `${TASKFLOW_API_ROOT}/${segment}`
  return {
    prefix,
    base,
    contract: createApi(base),
    socketUrl: (path) =>
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${TASKFLOW_WS_ROOT}/${segment}${path}`,
  }
}

/** The registry: listing, adding and removing Taskflow Projects is not about one of them. */
export const registryApi: ApiClient = createApi(TASKFLOW_API_ROOT)
