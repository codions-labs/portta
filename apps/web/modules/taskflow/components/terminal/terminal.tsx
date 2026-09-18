'use client'

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { type ITheme, Terminal as XtermTerminal } from '@xterm/xterm'
import { RefreshCw } from 'lucide-react'
import { forwardRef, type DragEvent as ReactDragEvent, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useTaskflowProject } from '../../lib/project.tsx'

export interface TerminalHandle {
  sendSelectPane: (pane: number) => void
  sendInput: (data: string) => void
}

interface TerminalProps {
  worktree: string
  isMobile?: boolean
  initialPane?: number
  terminalTheme: ITheme
  agentTerminalStale?: boolean
  refreshingAgentTerminal?: boolean
  onRefreshAgentTerminal?: () => void
}

/** ANSI-coloured notices the dashboard writes into the terminal itself. */
const notice = {
  muted: (text: string) => `\r\n\x1b[90m[${text}]\x1b[0m`,
  ok: (text: string) => `\r\n\x1b[32m[${text}]\x1b[0m`,
  warn: (text: string) => `\r\n\x1b[33m[${text}]\x1b[0m`,
  error: (text: string) => `\r\n\x1b[31m[${text}]\x1b[0m`,
}

function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {})
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function hasDragFiles(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && (dataTransfer.types.includes('Files') || dataTransfer.types.includes('text/uri-list')))
}

function extractImageUrlFromHtml(html: string): string | null {
  return html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? null
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  {
    worktree,
    isMobile = false,
    initialPane,
    terminalTheme,
    agentTerminalStale = false,
    refreshingAgentTerminal = false,
    onRefreshAgentTerminal,
  },
  ref,
) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'terminal' })
  const { api } = useTaskflowProject()
  // The connection effect outlives a language change; it reads the translator through a ref.
  const tRef = useRef(t)
  tRef.current = t
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const initialTerminalThemeRef = useRef(terminalTheme)
  const websocketRef = useRef<WebSocket | null>(null)
  const dragCounter = useRef(0)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  useImperativeHandle(
    ref,
    () => ({
      sendSelectPane(pane: number): void {
        if (websocketRef.current?.readyState === WebSocket.OPEN)
          websocketRef.current.send(JSON.stringify({ type: 'selectPane', pane }))
      },
      sendInput(data: string): void {
        if (websocketRef.current?.readyState === WebSocket.OPEN)
          websocketRef.current.send(JSON.stringify({ type: 'input', data }))
      },
    }),
    [],
  )

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme
  }, [terminalTheme])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let destroyed = false
    let canRetryVisibleClose = true
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let lastTouchX = 0
    let lastTouchY = 0
    let touchScrollLocked = false
    let pendingScrollPixels = 0
    let xtermElement: HTMLElement | null = null

    const terminal = new XtermTerminal({
      cursorBlink: true,
      theme: initialTerminalThemeRef.current,
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: isMobile ? 13 : 11,
      scrollback: 10000,
    })
    terminal.options.theme = initialTerminalThemeRef.current
    terminalRef.current = terminal
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(container)

    function shouldUseManualTouchScroll(): boolean {
      return isMobile && Boolean(xtermElement) && terminal.modes.mouseTrackingMode !== 'none'
    }

    function handleTouchStart(event: TouchEvent): void {
      if (!shouldUseManualTouchScroll()) return
      const touch = event.touches[0]
      if (!touch) return
      lastTouchX = touch.pageX
      lastTouchY = touch.pageY
      pendingScrollPixels = 0
      touchScrollLocked = false
    }

    function handleTouchMove(event: TouchEvent): void {
      const touch = event.touches[0]
      if (!shouldUseManualTouchScroll() || !xtermElement || !touch) return
      const deltaX = lastTouchX - touch.pageX
      const deltaY = lastTouchY - touch.pageY
      lastTouchX = touch.pageX
      lastTouchY = touch.pageY
      if (!touchScrollLocked) {
        if (Math.abs(deltaY) <= Math.abs(deltaX)) return
        touchScrollLocked = true
      }
      if (deltaY === 0) return
      // xterm 6 scrolls through its own scrollable element, not the viewport's
      // native scrollTop, so scrollback is moved by whole lines.
      if (terminal.buffer.active.baseY > 0) {
        const lineHeight = xtermElement.clientHeight / terminal.rows || 1
        pendingScrollPixels += deltaY
        const lines = Math.trunc(pendingScrollPixels / lineHeight)
        if (lines !== 0) {
          terminal.scrollLines(lines)
          pendingScrollPixels -= lines * lineHeight
        }
      } else
        xtermElement.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            deltaMode: WheelEvent.DOM_DELTA_PIXEL,
            deltaY,
          }),
        )
      event.preventDefault()
    }

    function handleTouchEnd(): void {
      touchScrollLocked = false
    }

    const nextXtermElement = container.querySelector('.xterm')
    if (nextXtermElement instanceof HTMLElement) {
      xtermElement = nextXtermElement
      xtermElement.addEventListener('touchstart', handleTouchStart, { passive: true })
      xtermElement.addEventListener('touchmove', handleTouchMove, { passive: false })
      xtermElement.addEventListener('touchend', handleTouchEnd)
      xtermElement.addEventListener('touchcancel', handleTouchEnd)
    }

    async function uploadAndTypeFiles(files: File[]): Promise<void> {
      try {
        const result = await api.uploadFiles(worktree, files)
        const paths = result.files.map((file) => file.path).join(' ')
        if (websocketRef.current?.readyState === WebSocket.OPEN)
          websocketRef.current.send(JSON.stringify({ type: 'input', data: paths }))
      } catch (caught) {
        terminal.writeln(
          notice.error(
            tRef.current('uploadError', { message: caught instanceof Error ? caught.message : String(caught) }),
          ),
        )
      }
    }

    function handlePaste(event: ClipboardEvent): void {
      if (!event.clipboardData) return
      const imageFiles: File[] = []
      for (const item of event.clipboardData.items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
      if (imageFiles.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      void uploadAndTypeFiles(imageFiles)
    }

    function buildResizeMessage(): string {
      return JSON.stringify({
        type: 'resize',
        cols: terminal.cols,
        rows: terminal.rows,
        ...(isMobile && initialPane !== undefined ? { initialPane } : {}),
      })
    }

    function connect(announceReconnect = false): void {
      const current = websocketRef.current
      if (destroyed || current?.readyState === WebSocket.OPEN || current?.readyState === WebSocket.CONNECTING) return
      const next = new WebSocket(api.socketUrl(`/ws/${encodeURIComponent(worktree)}`))
      websocketRef.current = next
      next.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        const prefix = event.data[0]
        if (prefix === 'o' || prefix === 's') {
          terminal.write(event.data.slice(1))
          return
        }
        try {
          const message: unknown = JSON.parse(event.data)
          if (!message || typeof message !== 'object') return
          if ('type' in message && message.type === 'exit' && 'exitCode' in message)
            terminal.writeln(notice.warn(tRef.current('exited', { code: String(message.exitCode) })))
          if ('type' in message && message.type === 'error' && 'message' in message)
            terminal.writeln(notice.error(tRef.current('error', { message: String(message.message) })))
        } catch {}
      }
      next.onerror = () => {}
      next.onopen = () => {
        if (websocketRef.current !== next) return
        canRetryVisibleClose = true
        fitAddon.fit()
        if (announceReconnect) terminal.writeln(notice.ok(tRef.current('reconnected')))
        requestAnimationFrame(() => {
          fitAddon.fit()
          terminal.focus()
        })
        next.send(buildResizeMessage())
      }
      next.onclose = () => {
        if (websocketRef.current !== next) return
        websocketRef.current = null
        if (destroyed) return
        terminal.writeln(notice.muted(tRef.current('disconnected')))
        if (!document.hidden && canRetryVisibleClose) {
          canRetryVisibleClose = false
          connect(true)
        }
      }
    }

    function reconnectIfNeeded(): void {
      if (!document.hidden) connect(true)
    }

    function preventContextMenu(event: Event): void {
      event.preventDefault()
    }

    container.addEventListener('contextmenu', preventContextMenu)
    container.addEventListener('paste', handlePaste, true)
    terminal.parser.registerOscHandler(52, (data) => {
      const index = data.indexOf(';')
      if (index !== -1) {
        try {
          copyToClipboard(atob(data.slice(index + 1)))
        } catch {}
      }
      return true
    })
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection()
      if (selection) copyToClipboard(selection)
    })
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.type === 'keydown' && websocketRef.current?.readyState === WebSocket.OPEN)
          websocketRef.current.send(
            JSON.stringify({ type: 'sendKeys', hexBytes: ['1b', '5b', '31', '33', '3b', '32', '75'] }),
          )
        return false
      }
      if (event.type !== 'keydown') return true
      const mod = event.metaKey || event.ctrlKey
      if (mod && (event.key === 'c' || event.key === 'C') && terminal.hasSelection()) {
        copyToClipboard(terminal.getSelection())
        terminal.clearSelection()
        return false
      }
      if (mod && ['ArrowUp', 'ArrowDown', 'k', 'K', 'm', 'M', 'd', 'D'].includes(event.key)) return false
      return true
    })
    requestAnimationFrame(() => {
      fitAddon.fit()
      terminal.focus()
    })
    connect()
    terminal.onData((data) => {
      if (websocketRef.current?.readyState === WebSocket.OPEN)
        websocketRef.current.send(JSON.stringify({ type: 'input', data }))
    })
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        fitAddon.fit()
        if (websocketRef.current?.readyState === WebSocket.OPEN)
          websocketRef.current.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
      }, 150)
    })
    resizeObserver.observe(container)
    document.addEventListener('visibilitychange', reconnectIfNeeded)
    window.addEventListener('focus', reconnectIfNeeded)
    window.addEventListener('online', reconnectIfNeeded)

    return () => {
      destroyed = true
      clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      container.removeEventListener('contextmenu', preventContextMenu)
      container.removeEventListener('paste', handlePaste, true)
      xtermElement?.removeEventListener('touchstart', handleTouchStart)
      xtermElement?.removeEventListener('touchmove', handleTouchMove)
      xtermElement?.removeEventListener('touchend', handleTouchEnd)
      xtermElement?.removeEventListener('touchcancel', handleTouchEnd)
      document.removeEventListener('visibilitychange', reconnectIfNeeded)
      window.removeEventListener('focus', reconnectIfNeeded)
      window.removeEventListener('online', reconnectIfNeeded)
      websocketRef.current?.close()
      websocketRef.current = null
      terminal.dispose()
      terminalRef.current = null
    }
  }, [api, initialPane, isMobile, worktree])

  async function decodeDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
    const direct = Array.from(dataTransfer.files).filter((file) => file.type.startsWith('image/'))
    if (direct.length > 0) return direct
    const html = dataTransfer.getData('text/html')
    const imageUrl = (html ? extractImageUrlFromHtml(html) : null) ?? dataTransfer.getData('text/uri-list')
    if (!imageUrl) return []
    try {
      const [, mimeType, base64] = imageUrl.match(/^data:(image\/[^;]+);base64,(.+)/) ?? []
      if (mimeType && base64) {
        const byteString = atob(base64)
        const bytes = new Uint8Array(byteString.length)
        for (let index = 0; index < byteString.length; index++) bytes[index] = byteString.charCodeAt(index)
        const extension = mimeType.split('/')[1]?.replace('+xml', '') || 'png'
        return [new File([bytes], `image.${extension}`, { type: mimeType })]
      }
      if (/^https?:\/\//i.test(imageUrl)) {
        const response = await fetch(imageUrl)
        const contentType = response.headers.get('content-type') ?? ''
        const contentLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
        if (response.ok && contentType.startsWith('image/') && contentLength <= 10 * 1024 * 1024) {
          const blob = await response.blob()
          const name = imageUrl.split('/').pop()?.split('?')[0]?.split('#')[0] || 'image.png'
          return [new File([blob], name, { type: blob.type })]
        }
      }
    } catch {}
    return []
  }

  async function handleDrop(event: ReactDragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current = 0
    setIsDraggingOver(false)
    const files = await decodeDroppedFiles(event.dataTransfer)
    if (files.length === 0) return
    try {
      const result = await api.uploadFiles(worktree, files)
      const paths = result.files.map((file) => file.path).join(' ')
      if (websocketRef.current?.readyState === WebSocket.OPEN)
        websocketRef.current.send(JSON.stringify({ type: 'input', data: paths }))
    } catch (caught) {
      terminalRef.current?.writeln(
        notice.error(t('uploadError', { message: caught instanceof Error ? caught.message : String(caught) })),
      )
    }
  }

  return (
    <div
      role="application"
      aria-label={t('label')}
      className="relative min-h-0 w-full flex-1 overflow-hidden bg-surface p-1"
      ref={containerRef}
      onDragEnter={(event) => {
        if (!hasDragFiles(event.dataTransfer)) return
        event.preventDefault()
        dragCounter.current += 1
        setIsDraggingOver(true)
      }}
      onDragOver={(event) => {
        if (!isDraggingOver) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        dragCounter.current -= 1
        if (dragCounter.current <= 0) {
          dragCounter.current = 0
          setIsDraggingOver(false)
        }
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      {agentTerminalStale ? (
        <div className="absolute top-3 right-3 left-3 z-20 flex items-center justify-between gap-3 rounded-md border border-warn/35 bg-overlay px-4 py-3 text-sm text-ink shadow-overlay">
          <span className="min-w-0 truncate">{t('stale')}</span>
          {onRefreshAgentTerminal ? (
            <Button
              size="sm"
              className="border-warn/40 text-warn hover:bg-warn/10"
              title={t('refreshTitle')}
              onClick={onRefreshAgentTerminal}
              disabled={refreshingAgentTerminal}
            >
              <RefreshCw aria-hidden className={refreshingAgentTerminal ? 'animate-spin' : undefined} />
              {refreshingAgentTerminal ? t('refreshing') : t('refresh')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {isDraggingOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-scrim">
          <span className="text-sm font-medium text-accent-fg">{t('drop')}</span>
        </div>
      ) : null}
    </div>
  )
})
