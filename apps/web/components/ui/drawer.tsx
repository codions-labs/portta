'use client'

import * as Primitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.ts'
import { ModalFooter, ModalHeader, Scrim } from './dialog.tsx'

/**
 * A panel that slides in from the right and keeps the page behind it visible:
 * the detail of one row, opened without leaving the list. Same primitive as
 * the dialog, so focus, escape, the scrim and the header behave the same way.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerActions,
  width = 'md',
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Controls that sit beside the close button. */
  headerActions?: ReactNode
  width?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Scrim />
        <Primitive.Content
          data-side="right"
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex h-full flex-col border-l border-line bg-surface shadow-modal outline-none',
            'data-[state=open]:animate-slide-in-right',
            width === 'lg' ? 'w-[min(96vw,56rem)]' : width === 'sm' ? 'w-[min(92vw,26rem)]' : 'w-[min(94vw,40rem)]',
            className,
          )}
        >
          <ModalHeader title={title} description={description}>
            {headerActions}
          </ModalHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scroll-thin">{children}</div>
          {footer ? <ModalFooter>{footer}</ModalFooter> : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
