'use client'

// Who you are, and the way out.
//
// In open mode there is nobody to sign out as, so the menu says what that means
// instead of offering a button that would do nothing.

import { LogOut, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { iconButton } from '@/components/ui/surfaces'
import { Tooltip } from '@/components/ui/tooltip'
import { signOut } from '@/lib/auth-client'
import { usePrincipal } from '@/lib/principal'
import { cn } from '@/lib/utils'

/** `full` draws the avatar and the name, for the foot of the rail; otherwise an icon. */
export function UserMenu({ full = false, className }: { full?: boolean; className?: string }) {
  const { t } = useTranslation('auth')
  const router = useRouter()
  const principal = usePrincipal()
  const local = principal.kind === 'local'

  return (
    <Menu>
      <Tooltip label={principal.name}>
        <MenuTrigger
          className={cn(
            full
              ? 'flex h-10 w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 text-left transition-colors duration-100 hover:bg-fill focus-ring'
              : iconButton,
            className,
          )}
          aria-label={principal.name}
        >
          {full ? (
            <>
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink"
              >
                {principal.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{principal.name}</span>
            </>
          ) : (
            <User />
          )}
        </MenuTrigger>
      </Tooltip>
      <MenuContent align="end" className="min-w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-xs font-medium text-ink">{principal.name}</p>
          <p className="truncate text-2xs text-subtle">{principal.email ?? t(`role.${principal.role}`)}</p>
        </div>
        {local ? (
          <p className="border-t border-line px-2 py-2 text-2xs text-subtle">{t('openMode')}</p>
        ) : (
          <MenuItem
            icon={<LogOut aria-hidden />}
            onSelect={() => {
              void signOut().then(() => {
                router.push('/sign-in')
                router.refresh()
              })
            }}
          >
            {t('signOut')}
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}
