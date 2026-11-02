'use client'

import { Eye, EyeOff } from 'lucide-react'
import { type InputHTMLAttributes, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from './field.tsx'

/** A password that can be looked at, for a phone where mistyping is the usual failure. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>) {
  const { t } = useTranslation('common')
  const [shown, setShown] = useState(false)
  return (
    <span className="relative block">
      <Input {...props} type={shown ? 'text' : 'password'} className="pr-11" />
      <button
        type="button"
        aria-pressed={shown}
        aria-label={shown ? t('hidePassword') : t('showPassword')}
        onClick={() => setShown((value) => !value)}
        className="absolute top-1 right-1 grid size-8 place-items-center rounded-md text-subtle hover:bg-fill hover:text-ink focus-ring"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  )
}
