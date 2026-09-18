import type { AppNotification } from '../types.ts'
import type { TaskflowClient } from './client.ts'

export interface NotificationStreamHandlers {
  onNotification: (notification: AppNotification) => void
  onDismiss: (id: number) => void
  onInitial?: (notification: AppNotification) => void
}

function parsed<T>(event: Event, use: (value: T) => void): void {
  try {
    use(JSON.parse((event as MessageEvent<string>).data) as T)
  } catch {
    // A malformed event is skipped; the next one still arrives.
  }
}

export function notificationApi({ contract, base }: TaskflowClient) {
  return {
    /** The Project's notification stream; returns the function that closes it. */
    subscribeNotifications(handlers: NotificationStreamHandlers): () => void {
      const source = new EventSource(`${base}/api/notifications/stream`)
      source.addEventListener('initial', (event) =>
        parsed(event, (value: AppNotification) => handlers.onInitial?.(value)),
      )
      source.addEventListener('notification', (event) => parsed(event, handlers.onNotification))
      source.addEventListener('dismiss', (event) =>
        parsed(event, (value: { id: number }) => handlers.onDismiss(value.id)),
      )
      return () => source.close()
    },
    dismissNotification: (id: number): Promise<void> =>
      contract.dismissNotification({ params: { id } }).then(() => undefined),
  }
}
