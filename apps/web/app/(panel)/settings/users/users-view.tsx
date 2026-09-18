'use client'

// Who can sign in, and what each of them reaches.
//
// Every write goes through the panel's own API: the rules about who may act on
// whom (03 §6.4) are Portta's, and Better Auth's client would not apply them.
// The rules are mirrored here only to keep a menu from offering an action the
// server would refuse — the server refuses it anyway.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, ShieldCheck, UserPlus } from 'lucide-react'
import type { Role, User } from 'portta-contracts'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreateUserDialog } from '@/components/settings/create-user-dialog'
import { PasswordDialog } from '@/components/settings/password-dialog'
import { ProjectAccessDialog } from '@/components/settings/project-access-dialog'
import { UserSessionsDialog } from '@/components/settings/user-sessions-dialog'
import { ErrorBox, Loading, PageHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { type Column, DataTable } from '@/components/ui/data-table'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { usePrincipal } from '@/lib/principal'
import { keys, useProjects, useUsers } from '@/lib/queries'
import { useFormat } from '@/lib/use-format'

const ROLE_TONE: Record<Role, 'accent' | 'neutral'> = {
  owner: 'accent',
  admin: 'accent',
  developer: 'neutral',
  viewer: 'neutral',
}

type Pending =
  | { kind: 'password'; user: User }
  | { kind: 'projects'; user: User }
  | { kind: 'sessions'; user: User }
  | { kind: 'remove'; user: User }
  | { kind: 'ban'; user: User }
  | { kind: 'transfer'; user: User }

export function UsersView() {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const { t: ta } = useTranslation('auth')
  const { relativeTime } = useFormat()
  const queryClient = useQueryClient()
  const principal = usePrincipal()
  const query = useUsers()
  const projects = useProjects()
  const mayCreate = useCan('user:create')
  const maySetRole = useCan('user:set-role')
  const maySetPassword = useCan('user:set-password')
  const mayBan = useCan('user:ban')
  const mayRemove = useCan('user:delete')
  const maySeeSessions = useCan('session:list')
  const mayScope = useCan('project:members')
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.users() })

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.setUserRole(id, role),
    onSuccess: invalidate,
  })
  const ban = useMutation({
    mutationFn: ({ id, banned }: { id: string; banned: boolean }) => api.banUser(id, { banned }),
    onSuccess: () => {
      setPending(null)
      return invalidate()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.removeUser(id),
    onSuccess: () => {
      setPending(null)
      return invalidate()
    },
  })
  const transfer = useMutation({
    mutationFn: (id: string) => api.transferOwnership(id),
    onSuccess: () => {
      setPending(null)
      return invalidate()
    },
  })

  const users = query.data ?? []
  const owners = users.filter((user) => user.role === 'owner').length
  const isSelf = useCallback((user: User) => user.email === principal.email, [principal.email])
  /** Only the owner acts on the owner, and nobody acts on themselves. */
  const mayWrite = useCallback((user: User) => !(user.role === 'owner' && principal.role !== 'owner'), [principal.role])

  const columns = useMemo<Column<User>[]>(
    () => [
      {
        id: 'name',
        header: t('users.name'),
        pinned: true,
        sortValue: (user) => user.name,
        cell: (user) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-ink">{user.name}</span>
              {isSelf(user) ? (
                <Badge tone="neutral" size="sm">
                  {t('users.you')}
                </Badge>
              ) : null}
            </div>
            <div className="truncate text-2xs text-subtle">{user.email}</div>
          </div>
        ),
      },
      {
        id: 'role',
        header: t('users.role'),
        sortValue: (user) => user.role,
        cell: (user) => <Badge tone={ROLE_TONE[user.role]}>{ta(`role.${user.role}`)}</Badge>,
      },
      {
        id: 'status',
        header: t('users.status'),
        sortValue: (user) => (user.banned ? 'banned' : 'active'),
        cell: (user) => (
          <div className="flex flex-wrap items-center gap-1">
            {user.banned ? (
              <Badge tone="danger">{t('users.banned')}</Badge>
            ) : (
              <Badge tone="ok">{t('users.active')}</Badge>
            )}
            {user.twoFactorEnabled ? (
              <Badge tone="neutral" icon={<ShieldCheck />}>
                {t('users.twoFactor')}
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: 'projects',
        header: t('users.projects'),
        priority: 2,
        cell: (user) =>
          user.role === 'owner' || user.role === 'admin' ? (
            <span className="text-xs text-subtle">{t('users.everyProject')}</span>
          ) : user.projects.length === 0 ? (
            <span className="text-xs text-subtle">{t('users.noProject')}</span>
          ) : (
            <span className="text-xs text-muted">{user.projects.map((project) => project.name).join(', ')}</span>
          ),
      },
      {
        id: 'createdAt',
        header: t('users.created'),
        priority: 3,
        sortValue: (user) => user.createdAt,
        cell: (user) => <span className="text-xs text-subtle">{relativeTime(user.createdAt)}</span>,
      },
      {
        id: 'actions',
        header: '',
        srHeader: tc('actions'),
        align: 'right',
        cell: (user) => (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('users.actionsFor', { name: user.name })}>
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              {maySetRole && !isSelf(user) && mayWrite(user)
                ? (['admin', 'developer', 'viewer'] as const).map((role) => (
                    <MenuItem
                      key={role}
                      disabled={user.role === role || setRole.isPending}
                      onSelect={() => setRole.mutate({ id: user.id, role })}
                    >
                      {t('users.makeRole', { role: ta(`role.${role}`) })}
                    </MenuItem>
                  ))
                : null}
              {maySetPassword && mayWrite(user) ? (
                <MenuItem onSelect={() => setPending({ kind: 'password', user })}>{t('users.setPassword')}</MenuItem>
              ) : null}
              {mayScope && user.role !== 'owner' && user.role !== 'admin' ? (
                <MenuItem onSelect={() => setPending({ kind: 'projects', user })}>{t('users.projectAccess')}</MenuItem>
              ) : null}
              {maySeeSessions ? (
                <MenuItem onSelect={() => setPending({ kind: 'sessions', user })}>{t('users.sessions')}</MenuItem>
              ) : null}
              {principal.role === 'owner' && !isSelf(user) && !user.banned ? (
                <>
                  <MenuSeparator />
                  <MenuItem onSelect={() => setPending({ kind: 'transfer', user })}>{t('users.transfer')}</MenuItem>
                </>
              ) : null}
              {mayBan && !isSelf(user) && mayWrite(user) ? (
                <MenuItem
                  tone={user.banned ? undefined : 'danger'}
                  onSelect={() =>
                    user.banned ? ban.mutate({ id: user.id, banned: false }) : setPending({ kind: 'ban', user })
                  }
                >
                  {user.banned ? t('users.unban') : t('users.ban')}
                </MenuItem>
              ) : null}
              {mayRemove && !isSelf(user) && mayWrite(user) && !(user.role === 'owner' && owners <= 1) ? (
                <MenuItem tone="danger" onSelect={() => setPending({ kind: 'remove', user })}>
                  {tc('remove')}
                </MenuItem>
              ) : null}
            </MenuContent>
          </Menu>
        ),
      },
    ],
    [
      ban,
      isSelf,
      mayBan,
      mayRemove,
      mayScope,
      maySeeSessions,
      maySetPassword,
      maySetRole,
      mayWrite,
      owners,
      principal.role,
      relativeTime,
      setRole,
      t,
      ta,
      tc,
    ],
  )

  if (query.isPending) return <Loading />
  if (query.error) return <ErrorBox error={query.error} />

  const failure = setRole.error ?? ban.error ?? remove.error ?? transfer.error

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        actions={
          mayCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <UserPlus />
              {t('users.create')}
            </Button>
          ) : null
        }
      />

      {failure ? (
        <div className="mb-4">
          <ErrorBox error={failure} />
        </div>
      ) : null}

      <Card>
        <DataTable
          rows={users}
          columns={columns}
          rowKey={(user) => user.id}
          storageKey="settings-users"
          initialSort={{ columnId: 'name', direction: 'asc' }}
          emptyTitle={t('users.empty')}
        />
      </Card>

      <CreateUserDialog
        open={creating}
        onOpenChange={setCreating}
        projects={projects.data ?? []}
        onCreated={invalidate}
      />

      {pending?.kind === 'password' ? (
        <PasswordDialog
          open
          onOpenChange={() => setPending(null)}
          title={t('users.setPasswordFor', { name: pending.user.name })}
          onSubmit={(password) => api.setUserPassword(pending.user.id, password)}
        />
      ) : null}

      {pending?.kind === 'projects' ? (
        <ProjectAccessDialog
          open
          onOpenChange={() => setPending(null)}
          user={pending.user}
          projects={projects.data ?? []}
          onSaved={invalidate}
        />
      ) : null}

      {pending?.kind === 'sessions' ? (
        <UserSessionsDialog open onOpenChange={() => setPending(null)} user={pending.user} />
      ) : null}

      {pending?.kind === 'ban' ? (
        <ConfirmDialog
          open
          onOpenChange={() => setPending(null)}
          title={t('users.banTitle', { name: pending.user.name })}
          impact={t('users.banImpact')}
          confirmLabel={t('users.ban')}
          busy={ban.isPending}
          error={ban.error}
          onConfirm={() => ban.mutate({ id: pending.user.id, banned: true })}
        />
      ) : null}

      {pending?.kind === 'remove' ? (
        <ConfirmDialog
          open
          onOpenChange={() => setPending(null)}
          title={t('users.removeTitle', { name: pending.user.name })}
          impact={t('users.removeImpact')}
          confirmLabel={tc('remove')}
          requireTyped={pending.user.email}
          requireTypedHint={t('users.removeTypeHint', { email: pending.user.email })}
          busy={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(pending.user.id)}
        />
      ) : null}

      {pending?.kind === 'transfer' ? (
        <ConfirmDialog
          open
          onOpenChange={() => setPending(null)}
          title={t('users.transferTitle', { name: pending.user.name })}
          impact={t('users.transferImpact', { name: pending.user.name })}
          confirmLabel={t('users.transfer')}
          requireTyped={pending.user.email}
          requireTypedHint={t('users.removeTypeHint', { email: pending.user.email })}
          busy={transfer.isPending}
          error={transfer.error}
          onConfirm={() => transfer.mutate(pending.user.id)}
        />
      ) : null}
    </>
  )
}
