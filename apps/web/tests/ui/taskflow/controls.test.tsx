import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastStack } from '@/modules/taskflow/components/shell/toast-stack'
import { PaneBar } from '@/modules/taskflow/components/terminal/pane-bar'
import type { ToastItem } from '@/modules/taskflow/lib/types'

afterEach(cleanup)

function createToast(overrides: Partial<ToastItem> = {}): ToastItem {
  return {
    id: 'notification:1',
    source: 'notification',
    notificationId: 1,
    tone: 'info',
    message: 'Notification text',
    detail: 'https://example.com/notifications/1',
    branch: 'feature/react-migration',
    ...overrides,
  }
}

describe('Taskflow controls', () => {
  it('selects panes by index', () => {
    const onSelect = vi.fn()
    render(
      <PaneBar
        activePane={0}
        panes={[
          { index: 0, label: 'Agent' },
          { index: 1, label: 'Web' },
        ]}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Web' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('keeps an agent notification selectable and dismissible', () => {
    const onDismiss = vi.fn()
    const onSelect = vi.fn()
    render(<ToastStack toasts={[createToast()]} onDismiss={onDismiss} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /notification text/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onSelect).toHaveBeenCalledWith('notification:1')
    expect(onDismiss).toHaveBeenCalledWith('notification:1')
  })
})
