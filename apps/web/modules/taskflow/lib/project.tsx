'use client'

// The Taskflow Project a page is about, bound once for everything under it.
//
// A Portta Project page knows its slug; Taskflow knows its Projects by a
// prefix. The gate (components/workspace/project-gate.tsx) resolves one to the
// other and mounts this provider, so a component never has to: it asks for the
// API, the query keys and the hrefs of *this* Project, and a test hands it a
// fake API instead.

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { useCan } from '@/lib/permissions'
import type { ProjectApi } from './api/index.ts'
import { type TaskflowPaths, taskflowPaths } from './navigation.ts'
import { type TaskflowKeys, taskflowKeys } from './queries/keys.ts'

export interface TaskflowProject {
  /** The Portta Project. */
  slug: string
  projectId: string
  /** The Taskflow Project it is served as. */
  prefix: string
  api: ProjectApi
  keys: TaskflowKeys
  paths: TaskflowPaths
}

const TaskflowProjectContext = createContext<TaskflowProject | null>(null)

export function TaskflowProjectProvider({
  slug,
  projectId,
  api,
  children,
}: {
  slug: string
  projectId: string
  api: ProjectApi
  children: ReactNode
}) {
  const value = useMemo<TaskflowProject>(
    () => ({ slug, projectId, prefix: api.prefix, api, keys: taskflowKeys(api.prefix), paths: taskflowPaths(slug) }),
    [api, projectId, slug],
  )
  return <TaskflowProjectContext.Provider value={value}>{children}</TaskflowProjectContext.Provider>
}

export function useTaskflowProject(): TaskflowProject {
  const value = useContext(TaskflowProjectContext)
  if (!value) throw new Error('useTaskflowProject was called outside a Taskflow Project')
  return value
}

/** Whether to offer an action on this Project: the permission, held here. The daemon's proxy decides again. */
export function useTaskflowCan(permission: string): boolean {
  return useCan(permission, useTaskflowProject().projectId)
}
