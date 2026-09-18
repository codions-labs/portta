import type { WorkflowCatalogGroup, WorkflowDefinition } from './types.ts'

const origins: Array<WorkflowDefinition['origin']> = ['project', 'global', 'builtin']

export function workflowTitle(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ')
}

export function groupWorkflows(workflows: WorkflowDefinition[]): WorkflowCatalogGroup[] {
  return origins
    .map((origin) => ({
      origin,
      workflows: workflows
        .filter((workflow) => workflow.origin === origin)
        .sort((left, right) => workflowTitle(left.name).localeCompare(workflowTitle(right.name))),
    }))
    .filter((group) => group.workflows.length > 0)
}
