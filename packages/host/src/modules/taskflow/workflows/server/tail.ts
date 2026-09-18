// Testable helpers for the viewer server's streaming + caching paths. Kept dependency-free
// (node builtins only) so they can be exercised directly without spinning the HTTP server.

import { type FileHandle, open, stat } from 'node:fs/promises'

/** Bounded read chunk size for SSE replay — avoids one whole-file alloc per client (M24). */
export const READ_CHUNK = 64 * 1024

export interface TailLine {
  /** The whole line (trimmed), newline excluded. */
  line: string
  /**
   * Byte offset in the file immediately AFTER this line's terminating newline — i.e. the
   * resume point. Emitted as the SSE `id:` so a reconnect with Last-Event-ID = this value
   * replays only what comes after, never this line again.
   */
  offset: number
}

export interface ReadResult {
  /** New byte offset after the read (== file size when fully drained, or shrink-reset to 0). */
  offset: number
  /**
   * Partial trailing line carried over to the next read (no terminating newline yet). Kept
   * as raw bytes — decoding happens only on complete lines, so a multibyte character split
   * across reads (or chunk boundaries) is never corrupted into U+FFFD.
   */
  pending: Buffer
  /** Whole lines parsed since the previous call, in file order, each with its resume offset. */
  lines: TailLine[]
  /** True when the file shrank/rotated and we restarted from byte 0. */
  reset: boolean
}

/**
 * Read `filePath` from `offset` to EOF in bounded chunks, returning the whole lines that
 * completed (each tagged with the byte offset just past its newline) plus any trailing
 * partial line carried in `pending`. Never allocates the whole unread region at once (M24).
 * Line splitting happens in the byte domain (0x0A never occurs inside a UTF-8 multibyte
 * sequence) and only complete lines are decoded, so chunk boundaries can't corrupt
 * multibyte characters or the byte-offset arithmetic. A file that shrank below `offset`
 * triggers a restart from byte 0 (reported via `reset`). A missing file yields no lines and
 * an unchanged offset.
 */
export async function readNewLines(filePath: string, offset: number, pending: Buffer): Promise<ReadResult> {
  let fh: FileHandle
  try {
    fh = await open(filePath, 'r')
  } catch {
    return { offset, pending, lines: [], reset: false }
  }
  const lines: TailLine[] = []
  let reset = false
  try {
    const { size } = await fh.stat()
    if (size < offset) {
      offset = 0
      pending = Buffer.alloc(0)
      reset = true
    }
    const buf = Buffer.allocUnsafe(READ_CHUNK)
    // Byte offset of the start of the `pending` buffer within the file, so each completed
    // line's resume offset is computed from real bytes.
    let pendingStart = offset - pending.length
    while (offset < size) {
      const want = Math.min(READ_CHUNK, size - offset)
      const { bytesRead } = await fh.read(buf, 0, want, offset)
      if (bytesRead <= 0) break
      offset += bytesRead
      // Copy out of the reusable chunk buffer before carrying bytes across iterations.
      const chunk = buf.subarray(0, bytesRead)
      pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk])
      let nl = pending.indexOf(0x0a)
      while (nl !== -1) {
        const raw = pending.subarray(0, nl)
        const line = raw.toString('utf8').trim()
        // Resume point = bytes consumed up to and including this newline.
        const lineEnd = pendingStart + nl + 1 // +1 for "\n"
        pending = pending.subarray(nl + 1)
        pendingStart = lineEnd
        if (line) lines.push({ line, offset: lineEnd })
        nl = pending.indexOf(0x0a)
      }
    }
  } finally {
    await fh.close()
  }
  return { offset, pending, lines, reset }
}

/**
 * Walk up from `dir` to find the nearest path that exists, so fs.watch has a real target
 * even before a not-yet-created directory appears (M23). Returns `dir` itself if it exists,
 * otherwise the closest existing ancestor, otherwise undefined (no ancestor readable).
 */
export async function nearestExistingDir(dir: string): Promise<string | undefined> {
  let cur = dir
  // Guard against an unbounded loop on malformed paths: dirname is a fixed point at the root.
  for (let i = 0; i < 64; i++) {
    try {
      const st = await stat(cur)
      if (st.isDirectory()) return cur
    } catch {
      // not here — climb
    }
    const parent = parentOf(cur)
    if (parent === cur) return undefined
    cur = parent
  }
  return undefined
}

function parentOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (idx <= 0) return p.length > 1 && (p[0] === '/' || p[0] === '\\') ? p.slice(0, 1) : p
  return p.slice(0, idx)
}

/**
 * Last-Event-ID is a byte offset into the tailed file. Parse it leniently: a non-negative
 * integer resumes from that offset; anything else (absent, malformed, EventSource's empty
 * string) starts from 0.
 */
export function parseLastEventId(raw: string | string[] | undefined): number {
  if (raw === undefined) return 0
  const v = Array.isArray(raw) ? raw[0] : raw
  if (v === undefined) return 0
  const n = Number(v.trim())
  return Number.isInteger(n) && n >= 0 ? n : 0
}
