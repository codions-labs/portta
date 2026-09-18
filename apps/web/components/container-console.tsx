'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { socketUrl } from '../lib/ws.ts'
import { Badge } from './ui/badge.tsx'

type State = 'idle' | 'loading' | 'connecting' | 'open' | 'closed' | 'failed'

export function ContainerConsole({
  environment,
  service,
  enabled,
}: {
  environment: string
  service: string
  enabled: boolean
}) {
  const { t } = useTranslation('services', { keyPrefix: 'console' })
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<State>('idle')

  useEffect(() => {
    if (!enabled || !host.current) {
      setState('idle')
      return
    }
    let disposed = false
    let socket: WebSocket | null = null
    let observer: ResizeObserver | null = null
    let disposeTerminal: (() => void) | null = null
    setState('loading')

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-web-links')])
      .then(([{ Terminal }, { FitAddon }, { WebLinksAddon }]) => {
        if (disposed || !host.current) return
        const styles = getComputedStyle(document.documentElement)
        const colour = (name: string) => styles.getPropertyValue(name).trim()
        const terminal = new Terminal({
          cursorBlink: true,
          convertEol: true,
          fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
          fontSize: 13,
          scrollback: 5_000,
          theme: {
            background: colour('--portta-surface-2'),
            foreground: colour('--portta-text'),
            cursor: colour('--portta-accent'),
            selectionBackground: colour('--portta-selection'),
            black: colour('--portta-bg'),
            brightBlack: colour('--portta-subtle'),
            red: colour('--portta-danger'),
            green: colour('--portta-ok'),
            yellow: colour('--portta-warn'),
            blue: colour('--portta-info'),
            magenta: colour('--portta-agent'),
            cyan: colour('--portta-accent'),
            white: colour('--portta-muted'),
            brightWhite: colour('--portta-text'),
          },
        })
        const fit = new FitAddon()
        terminal.loadAddon(fit)
        terminal.loadAddon(new WebLinksAddon())
        terminal.open(host.current)
        fit.fit()
        terminal.focus()

        const query = new URLSearchParams({ service })
        socket = new WebSocket(socketUrl(`/ws/environments/${encodeURIComponent(environment)}/console?${query}`))
        socket.binaryType = 'arraybuffer'
        setState('connecting')
        const sendSize = () => {
          if (socket?.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        }
        socket.onopen = () => sendSize()
        socket.onmessage = (event) => {
          if (typeof event.data === 'string') {
            try {
              const message = JSON.parse(event.data) as { kind?: string; message?: string }
              if (message.kind === 'open') {
                setState('open')
                sendSize()
                terminal.focus()
              } else if (message.kind === 'error') {
                setState('failed')
                terminal.writeln(`\r\n${message.message ?? t('failed')}`)
              } else if (message.kind === 'notice') terminal.writeln(`\r\n${message.message ?? ''}`)
            } catch {
              /* unknown control frames are ignored */
            }
            return
          }
          if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data))
          else if (event.data instanceof Blob)
            void event.data.arrayBuffer().then((data) => terminal.write(new Uint8Array(data)))
        }
        socket.onerror = () => setState('failed')
        socket.onclose = () => setState((current) => (current === 'failed' ? current : 'closed'))

        const input = terminal.onData((data) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data))
        })
        observer = new ResizeObserver(() => {
          fit.fit()
          sendSize()
        })
        observer.observe(host.current)
        disposeTerminal = () => {
          input.dispose()
          terminal.dispose()
        }
      })
      .catch(() => setState('failed'))

    return () => {
      disposed = true
      observer?.disconnect()
      socket?.close(1000, 'console closed by user')
      disposeTerminal?.()
    }
  }, [enabled, environment, service, t])

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface-2">
      <div className="flex h-7 items-center justify-between border-b border-line px-2 text-xs text-muted">
        <span>
          {environment} · {service}
        </span>
        <Badge tone={state === 'open' ? 'ok' : state === 'failed' ? 'danger' : state === 'closed' ? 'warn' : 'neutral'}>
          {t(`state.${state}`)}
        </Badge>
      </div>
      <div
        ref={host}
        role="region"
        className="h-[45vh] min-h-64 p-2 [&_.xterm]:h-full"
        aria-label={t('terminalLabel', { service })}
      />
    </div>
  )
}
