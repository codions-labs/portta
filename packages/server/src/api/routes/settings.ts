// The panel's own settings, the ones that live in the database.
//
// `/config` is the other half: the gateway's `.env`, a fixed catalogue of keys
// written to a file. What is here is stored as a row and read by the panel
// itself — starting with the ceiling over a local agent, which is a decision
// about who may do what and belongs beside the roles rather than in a file the
// host also reads.

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { AGENT_DEFAULT_PERMISSIONS, PERMISSIONS } from 'portta-auth-core'
import { AgentPermissions, SetAgentPermissions } from 'portta-contracts'
import type { AppDeps } from '../../deps.ts'
import { record } from '../audit.ts'
import { documentRoute } from '../openapi.ts'

export function settingsRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  async function view() {
    const stored = await deps.db.settings.getGlobal('agentPermissions')
    return {
      permissions: [...(stored ?? AGENT_DEFAULT_PERMISSIONS)],
      defaults: [...AGENT_DEFAULT_PERMISSIONS],
      available: [...PERMISSIONS],
      configured: stored !== null,
    }
  }

  app.get(
    '/settings/agent-permissions',
    documentRoute({
      tag: 'Configuration',
      operationId: 'getAgentPermissions',
      permission: 'settings:read',
      summary: 'What a local agent may do',
      description:
        'The ceiling over a request that announces itself with X-Portta-Actor. A permission a role does not hold is still refused: this narrows, it never grants.',
      response: AgentPermissions,
      errors: [401, 403, 500, 503],
    }),
    async (c) => c.json(await view()),
  )

  app.put(
    '/settings/agent-permissions',
    documentRoute({
      tag: 'Configuration',
      operationId: 'setAgentPermissions',
      permission: 'settings:manage',
      summary: 'Set what a local agent may do',
      description:
        'Send null to restore the default. Unknown names are refused here rather than ignored later, so a typo is visible while somebody is looking at it.',
      request: SetAgentPermissions,
      response: AgentPermissions,
      errors: [400, 401, 403, 500, 503],
    }),
    async (c) => {
      const body = SetAgentPermissions.parse(await c.req.json().catch(() => null))
      if (body.permissions === null) {
        await deps.db.settings.clearGlobal('agentPermissions')
        await record(deps, c, {
          action: 'settings.changed',
          resourceType: 'settings',
          resourceName: 'agentPermissions',
          metadata: { restored: 'default' },
        })
        return c.json(await view())
      }
      const known = new Set<string>(PERMISSIONS)
      const unknown = body.permissions.filter((permission) => !known.has(permission))
      if (unknown.length > 0) {
        throw new HTTPException(400, { message: `not a permission this panel knows: ${unknown.join(', ')}` })
      }
      const permissions = [...new Set(body.permissions)].sort()
      await deps.db.settings.setGlobal('agentPermissions', permissions)
      await record(deps, c, {
        action: 'settings.changed',
        resourceType: 'settings',
        resourceName: 'agentPermissions',
        metadata: { permissions },
      })
      return c.json(await view())
    },
  )

  return app
}
