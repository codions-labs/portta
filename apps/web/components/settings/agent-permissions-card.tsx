'use client'

// What a local agent may do.
//
// An agent announces itself with `X-Portta-Actor` and holds the intersection of
// its person's role and this list — so this narrows, and can never grant. The
// available names come from the panel rather than from a list kept here: a
// panel that learns a new permission offers it without this file changing.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Save } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox, SkeletonRows } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Checkbox, Label } from '@/components/ui/field'
import { api } from '@/lib/api'
import { keys, useAgentPermissions } from '@/lib/queries'

/** `task:write` and `task:read` belong together; the resource is the heading. */
function byResource(permissions: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const permission of permissions) {
    const resource = permission.split(':')[0] ?? permission
    groups.set(resource, [...(groups.get(resource) ?? []), permission])
  }
  return [...groups]
}

export function AgentPermissionsCard({ editable }: { editable: boolean }) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const query = useAgentPermissions()
  const [draft, setDraft] = useState<string[] | null>(null)

  const save = useMutation({
    mutationFn: (permissions: string[] | null) => api.setAgentPermissions(permissions),
    onSuccess: (next) => {
      setDraft(null)
      queryClient.setQueryData(keys.agentPermissions(), next)
    },
  })

  const current = query.data
  const selected = useMemo(() => new Set(draft ?? current?.permissions ?? []), [draft, current])
  const groups = useMemo(() => byResource(current?.available ?? []), [current?.available])

  if (query.isPending) return <SkeletonRows rows={4} />
  if (query.error) return <ErrorBox error={query.error} />
  if (!current) return null

  const dirty = draft !== null && !same(draft, current.permissions)

  const toggle = (permission: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(permission)
    else next.delete(permission)
    setDraft([...next].sort())
  }

  return (
    <Card>
      <CardHeader
        title={t('agentPermissions.title')}
        description={t('agentPermissions.description')}
        actions={
          editable ? (
            <>
              {current.configured ? (
                <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>
                  <RotateCcw />
                  {t('agentPermissions.restoreDefault')}
                </Button>
              ) : (
                <Badge tone="neutral">{t('agentPermissions.usingDefault')}</Badge>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate([...selected])}
              >
                <Save />
                {save.isPending ? tc('saving') : tc('save')}
              </Button>
            </>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        {save.error ? <ErrorBox error={save.error} /> : null}
        {groups.map(([resource, permissions]) => (
          <div key={resource} className="grid gap-1.5">
            <Label className="text-2xs tracking-wide uppercase">{resource}</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {permissions.map((permission) => (
                <label key={permission} className="flex items-center gap-1.5 text-sm text-muted">
                  <Checkbox
                    // The visible text is the action, under its resource's
                    // heading; the accessible name has to be the whole
                    // permission, or half this list is a box called "read".
                    aria-label={permission}
                    checked={selected.has(permission)}
                    disabled={!editable || save.isPending}
                    onChange={(event) => toggle(permission, event.currentTarget.checked)}
                  />
                  <span>{permission.split(':')[1]}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function same(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
