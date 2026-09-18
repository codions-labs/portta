import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib-utils.ts'

/**
 * The login page's button: a deliberate copy of the panel's Button
 * (apps/web/components/ui/button.tsx), because this app is a separate Vite
 * build that may not import from the panel.
 *
 * Small by default: a tool that is used all day is made of `sm` controls,
 * and `md` is for the one action a page is about. The icon inside is sized
 * by the button, not by the caller, so a row of buttons lines up.
 */
const button = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap',
    'select-none transition-colors duration-100 focus-ring',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent',
        /** The everyday button: a hairline and a quiet surface. */
        default: 'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-3',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-3',
        /** For an action that is available but should not compete for the eye. */
        subtle: 'bg-surface-3 text-ink hover:bg-surface-4 active:bg-surface-4',
        ghost: 'text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-3',
        outline: 'border border-line text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-3',
        danger: 'border border-danger/40 text-danger hover:bg-danger/10 active:bg-danger/15',
        link: 'h-auto px-0 text-accent underline-offset-2 hover:underline',
      },
      size: {
        xs: 'h-6 px-1.5 text-2xs [&_svg]:size-3',
        sm: 'h-7 px-2 text-xs [&_svg]:size-3.5',
        md: 'h-8 px-2.5 text-sm [&_svg]:size-4',
        icon: 'h-7 w-7 [&_svg]:size-4',
        'icon-sm': 'h-6 w-6 [&_svg]:size-3.5',
        'icon-xs': 'h-5 w-5 rounded-sm [&_svg]:size-3',
        'icon-md': 'h-8 w-8 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  children?: ReactNode
}

export function Button({ className, variant, size, children, type, ...props }: ButtonProps) {
  return (
    <button type={type ?? 'button'} className={cn(button({ variant, size }), className)} {...props}>
      {children}
    </button>
  )
}
