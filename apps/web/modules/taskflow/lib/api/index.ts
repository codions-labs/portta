// The dashboard's API, in one place, so a component imports one path and a
// test replaces one object.
//
// Everything about one Taskflow Project is bound to its prefix by
// `createProjectApi`, and a page reaches it through `useTaskflowProject()`
// (lib/project.tsx). The registry is not about one Project, so its calls are
// plain functions.

import { agentApi } from './agents.ts'
import { taskflowClient } from './client.ts'
import { conversationApi } from './conversation.ts'
import { environmentApi } from './environments.ts'
import { notificationApi } from './notifications.ts'
import { runApi } from './runs.ts'
import { worktreeApi } from './worktrees.ts'

export { fetchProjects, removeProject, setUpProject } from './projects.ts'

export function createProjectApi(prefix: string) {
  const client = taskflowClient(prefix)
  return {
    prefix,
    socketUrl: client.socketUrl,
    ...agentApi(client),
    ...conversationApi(client),
    ...environmentApi(client),
    ...notificationApi(client),
    ...runApi(client),
    ...worktreeApi(client),
  }
}

export type ProjectApi = ReturnType<typeof createProjectApi>
