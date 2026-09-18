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

export function UserMenu() {
  const { t } = useTranslation('auth')
  const router = useRouter()
  const principal = usePrincipal()
  const local = principal.kind === 'local'

  return (
    <Menu>
      <Tooltip label={principal.name}>
        <MenuTrigger className={iconButton} aria-label={principal.name}>
          <User />
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
