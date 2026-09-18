import { randomUUID } from 'node:crypto'
import type { RawData, WebSocket } from 'ws'
import {
  attach,
  clearCallbacks,
  detach,
  getScrollback,
  resize,
  selectPane,
  sendKeys,
  setCallbacks,
  write,
} from '../../adapters/terminal.ts'
import { webTerminalUnsupportedMessage } from '../../adapters/web-terminal-support.ts'
import { log } from '../../lib/log.ts'
import { isRecord, isStringArray } from '../../lib/type-guards.ts'
import type { WsRoute } from './upgrade.ts'

type WsInboundMessage =
  | { type: 'input'; data: string }
  | { type: 'sendKeys'; hexBytes: string[] }
  | { type: 'selectPane'; pane: number }
  | { type: 'resize'; cols: number; rows: number; initialPane?: number }

type WsOutboundMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }
  | { type: 'scrollback'; data: string }

interface TerminalState {
  branch: string
  worktreeId: string | null
  attachId: string | null
  attached: boolean
}

export function parseWsMessage(raw: RawData): WsInboundMessage | null {
  try {
    const str = Array.isArray(raw) ? Buffer.concat(raw).toString() : new TextDecoder().decode(raw)
    const msg: unknown = JSON.parse(str)
    if (!isRecord(msg)) return null
    const m = msg
    switch (m.type) {
      case 'input':
        return typeof m.data === 'string' ? { type: 'input', data: m.data } : null
      case 'sendKeys':
        return isStringArray(m.hexBytes) ? { type: 'sendKeys', hexBytes: m.hexBytes } : null
      case 'selectPane':
        return typeof m.pane === 'number' ? { type: 'selectPane', pane: m.pane } : null
      case 'resize':
        return typeof m.cols === 'number' && typeof m.rows === 'number'
          ? {
              type: 'resize',
              cols: m.cols,
              rows: m.rows,
              initialPane: typeof m.initialPane === 'number' ? m.initialPane : undefined,
            }
          : null
      default:
        return null
    }
  } catch {
    return null
  }
}

/** Send a WsOutboundMessage. Hot-path messages (output/scrollback) use a
 *  single-character prefix to avoid JSON encode/decode overhead. */
function sendWs(ws: { send: (data: string) => void }, msg: WsOutboundMessage): void {
  switch (msg.type) {
    case 'output':
      ws.send(`o${msg.data}`)
      break
    case 'scrollback':
      ws.send(`s${msg.data}`)
      break
    default:
      ws.send(JSON.stringify(msg))
  }
}

function getAttachedSessionId(data: TerminalState, ws: WebSocket): string | null {
  if (data.attached && data.attachId) {
    return data.attachId
  }

  sendWs(ws, { type: 'error', message: 'Terminal not attached' })
  return null
}

function makeCallbacks(ws: WebSocket): {
  onData: (data: string) => void
  onExit: (exitCode: number) => void
} {
  return {
    onData: (data: string) => {
      if (ws.readyState <= 1) sendWs(ws, { type: 'output', data })
    },
    onExit: (exitCode: number) => {
      if (ws.readyState <= 1) sendWs(ws, { type: 'exit', exitCode })
    },
  }
}

/** The browser terminal of a worktree: attach on the first resize, then relay
 *  input, keys, pane selection and resizes to the multiplexer. */
export const terminalSocketRoute: WsRoute = {
  path: '/:prefix/ws/:worktree',
  handle(ws, { params, project }) {
    const data: TerminalState = { branch: params.worktree ?? '', worktreeId: null, attachId: null, attached: false }
    const { branch } = data
    log.debug(`[ws] open branch=${branch}`)

    ws.on('message', async (message: RawData): Promise<void> => {
      const msg = parseWsMessage(message)
      if (!msg) {
        sendWs(ws, { type: 'error', message: 'malformed message' })
        return
      }

      switch (msg.type) {
        case 'input': {
          const attachId = getAttachedSessionId(data, ws)
          if (!attachId) return
          // Cheap path: in-memory check first — disk read + write only when
          // actually armed. Survives a re-arm on the same WS (no stale cache).
          if (project.runtime.projectRuntime.getWorktreeByBranch(branch)?.oneshot) {
            void project.disarmOneshotIfArmed(branch, 'terminal-ws-input')
          }
          write(attachId, msg.data)
          break
        }
        case 'sendKeys': {
          const attachId = getAttachedSessionId(data, ws)
          if (!attachId) return
          if (project.runtime.projectRuntime.getWorktreeByBranch(branch)?.oneshot) {
            void project.disarmOneshotIfArmed(branch, 'terminal-ws-send-keys')
          }
          await sendKeys(attachId, msg.hexBytes)
          break
        }
        case 'selectPane':
          {
            const attachId = getAttachedSessionId(data, ws)
            if (!attachId) return
            log.debug(`[ws] selectPane pane=${msg.pane} branch=${branch} attachId=${attachId}`)
            await selectPane(attachId, msg.pane)
          }
          break
        case 'resize':
          if (!data.attached) {
            // First resize = client reporting actual dimensions. Attach now.
            data.attached = true
            log.debug(`[ws] first resize (attaching) branch=${branch} cols=${msg.cols} rows=${msg.rows}`)
            // The web terminal is tmux-only. It works by attaching a grouped
            // session (`new-session -t` + `window-size latest`) so each browser
            // tab gets its own independently-sized view of a shared window.
            // herdr has no equivalent: nothing in its API accepts rows/cols, and
            // `pane.read` is a snapshot rather than a live byte stream. Fail
            // loudly here instead of hanging on an attach that cannot work.
            const herdrTerminalError = webTerminalUnsupportedMessage(project.runtime.config.multiplexer)
            if (herdrTerminalError) {
              data.attached = false
              sendWs(ws, {
                type: 'error',
                message: herdrTerminalError,
              })
              break
            }
            try {
              if (msg.initialPane !== undefined) {
                log.debug(`[ws] initialPane=${msg.initialPane} branch=${branch}`)
              }
              const terminalWorktree = await project.resolveTerminalWorktree(branch)
              const attachId = `${terminalWorktree.worktreeId}:${randomUUID()}`
              data.worktreeId = terminalWorktree.worktreeId
              data.attachId = attachId
              await attach(attachId, terminalWorktree.attachTarget, msg.cols, msg.rows, msg.initialPane)
              const { onData, onExit } = makeCallbacks(ws)
              setCallbacks(attachId, onData, onExit)
              const scrollback = getScrollback(attachId)
              log.debug(
                `[ws] attached branch=${branch} worktreeId=${terminalWorktree.worktreeId} attachId=${attachId} scrollback=${scrollback.length} bytes`,
              )
              if (scrollback.length > 0) {
                sendWs(ws, { type: 'scrollback', data: scrollback })
              }
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err)
              data.attached = false
              data.worktreeId = null
              data.attachId = null
              log.error(`[ws] attach failed branch=${branch}: ${errMsg}`)
              sendWs(ws, { type: 'error', message: errMsg })
              ws.close(1011, errMsg.slice(0, 123)) // 1011 = Internal Error
            }
          } else {
            const attachId = getAttachedSessionId(data, ws)
            if (!attachId) return
            await resize(attachId, msg.cols, msg.rows)
          }
          break
      }
    })

    ws.on('close', (code: number, reason: Buffer): void => {
      log.debug(
        `[ws] close branch=${branch} code=${code} reason=${reason.toString()} attached=${data.attached} worktreeId=${data.worktreeId} attachId=${data.attachId}`,
      )
    })

    return async (): Promise<void> => {
      if (data.attachId) {
        clearCallbacks(data.attachId)
        await detach(data.attachId)
      }
    }
  },
}
