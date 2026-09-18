// One JSONL append writer shared by the transcript and event logs. Both are observability-only;
// a disk hiccup (ENOSPC/EACCES) must degrade to best-effort and never crash the run process. The
// 'error' handler latches the stream dead and drops subsequent writes silently (best-effort).

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'

export interface JsonlWriterOpts {
  /** "w" truncates a stale partial (transcript re-run); "a" appends (events log). Default "a". */
  flags?: 'a' | 'w'
  /** Invoked once when the underlying stream errors. Best-effort; never throws. */
  onError?: (err: Error) => void
}

export class JsonlWriter {
  private readonly stream: WriteStream
  private dead = false

  constructor(filePath: string, opts: JsonlWriterOpts = {}) {
    mkdirSync(dirOf(filePath), { recursive: true })
    this.stream = createWriteStream(filePath, { flags: opts.flags ?? 'a' })
    // Without this, an async stream error (ENOSPC mid-run) is unhandled and crashes the process.
    this.stream.on('error', (err: Error) => {
      this.dead = true
      try {
        opts.onError?.(err)
      } catch {
        // a throwing error handler must not re-escalate
      }
    })
  }

  /** Serialize + append one record. Swallows stringify failures and post-death writes. */
  writeRecord(record: unknown): void {
    if (this.dead) return
    let line: string
    try {
      line = JSON.stringify(record)
    } catch {
      return
    }
    if (typeof line !== 'string') return
    try {
      this.stream.write(`${line}\n`)
    } catch {
      this.dead = true
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.dead) {
        resolve()
        return
      }
      this.stream.end(() => resolve())
    })
  }
}

function dirOf(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return i <= 0 ? '.' : filePath.slice(0, i)
}
