'use client'

import { X } from 'lucide-react'
import { APP_DEFAULTS } from 'portta-core/taskflow/config'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/field'
import { iconButton } from '@/components/ui/surfaces'
import { Switch } from '@/components/ui/switch'
import { usePreferences } from '../../lib/preferences.tsx'
import { useConfig } from '../../lib/queries/config.ts'
import { useLinearIssues } from '../../lib/queries/worktrees.ts'
import { makeCursorUrl } from '../../lib/utils.ts'
import { LinearPanel } from '../integrations/linear-panel.tsx'
import { useNotifications } from '../shell/notifications.tsx'
import { SidebarRepoRow } from '../shell/sidebar-repo-row.tsx'
import { useWorktreeActions } from './worktree-actions.tsx'
import { WorktreeList } from './worktree-list.tsx'
import { useWorktreeSelection } from './worktree-selection.tsx'

const SEARCH_INPUT_ID = 'worktree-search'

/** The search box and the archived toggle, at the top of the Worktrees sidebar. */
export function WorktreeFilters() {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'sidebar' })
  const { searchQuery, setSearchQuery, trimmedSearch, showArchived, setShowArchived, archivedCount } =
    useWorktreeSelection()

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="relative">
        <Input
          id={SEARCH_INPUT_ID}
          size="sm"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="pr-7"
          placeholder={t('search')}
          aria-label={t('search')}
        />
        {trimmedSearch ? (
          <button
            type="button"
            className={`${iconButton} absolute top-1/2 right-0.5 size-5 -translate-y-1/2`}
            onClick={() => {
              setSearchQuery('')
              document.getElementById(SEARCH_INPUT_ID)?.focus()
            }}
            aria-label={t('clearSearch')}
          >
            <X />
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-2xs text-subtle">
        <Switch
          checked={showArchived}
          size="sm"
          aria-label={t('showArchivedLabel')}
          onCheckedChange={setShowArchived}
        />
        <span>{archivedCount > 0 ? t('showArchivedCount', { count: archivedCount }) : t('showArchived')}</span>
      </div>
    </div>
  )
}

/** The Worktrees sidebar: the list, the project's repositories and the Linear panel. */
export function WorktreeSidebar() {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'sidebar' })
  const config = useConfig()
  const { sshHost } = usePreferences()
  const { notifiedBranches } = useNotifications()
  const actions = useWorktreeActions()
  const { visibleRows, selectedBranch, trimmedSearch, hiddenArchivedMatchCount, archivedCount, showArchived, select } =
    useWorktreeSelection()
  const linear = useLinearIssues()
  const linearAvailability = linear.data?.availability ?? 'disabled'
  const emptyMessage = trimmedSearch
    ? hiddenArchivedMatchCount > 0
      ? t('archivedMatchesHidden')
      : t('noMatches', { query: trimmedSearch })
    : archivedCount > 0 && !showArchived
      ? t('noActive')
      : t('empty')

  return (
    <>
      <WorktreeList
        rows={visibleRows}
        selected={selectedBranch}
        removing={actions.removing}
        initializing={actions.opening}
        archiving={actions.archiving}
        postingLinear={actions.postingLinear}
        notifiedBranches={notifiedBranches}
        emptyMessage={emptyMessage}
        onSelect={select}
        onClose={actions.allowed.write ? actions.close : undefined}
        onArchive={actions.allowed.write ? actions.toggleArchived : undefined}
        onMerge={actions.allowed.merge ? actions.requestMerge : undefined}
        onRemove={actions.allowed.remove ? actions.requestRemove : undefined}
        onEditProfile={actions.allowed.write ? actions.editProfile : undefined}
        onCreateSubworktree={actions.allowed.write ? actions.openSubworktree : undefined}
        onPostToLinear={actions.allowed.linearWrite ? actions.postToLinear : undefined}
      />
      {config.projectDir ? (
        <SidebarRepoRow
          label={config.mainBranch || APP_DEFAULTS.mainBranch}
          cursorUrl={makeCursorUrl(config.projectDir, sshHost) ?? ''}
          onPull={actions.allowed.write ? () => actions.requestPull(null) : undefined}
        />
      ) : null}
      {(config.linkedRepos ?? [])
        .filter((repo) => repo.dir)
        .map((repo) => (
          <SidebarRepoRow
            key={repo.alias}
            label={repo.alias}
            cursorUrl={makeCursorUrl(repo.dir, sshHost) ?? ''}
            onPull={actions.allowed.write ? () => actions.requestPull(repo.alias) : undefined}
          />
        ))}
      {linearAvailability !== 'disabled' ? (
        <LinearPanel
          issues={linear.data?.issues ?? []}
          availability={linearAvailability}
          onAssign={actions.allowed.write ? (issue) => actions.openCreate(issue) : undefined}
          onSelect={actions.showLinearIssue}
        />
      ) : null}
    </>
  )
}
