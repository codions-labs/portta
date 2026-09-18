import type { ProjectLogLine } from 'portta-contracts'
import type { LogLine } from './docker/client.ts'

export interface LogSourceLines {
  service: string
  lines: LogLine[]
}

export interface MergeResult {
  lines: ProjectLogLine[]
  /** False when at least one line carried no timestamp, so order is approximate. */
  ordered: boolean
  truncated: boolean
}

/**
 * Interleave several services into one stream.
 *
 * Docker stamps every line with an RFC 3339 timestamp for the standard logging
 * drivers, which is the only reason this is possible at all. A driver that does
 * not is not an error: a line without a timestamp keeps its neighbours rather
 * than jumping to the front, and the result says ordering is approximate so the
 * view can say so too.
 */
export function mergeLogSources(sources: LogSourceLines[], limit: number): MergeResult {
  let ordered = true

  const tagged = sources.flatMap((source) =>
    source.lines.map((line, index) => {
      if (line.timestamp === null) ordered = false
      return { line, source: source.service, index }
    }),
  )

  // A line with no timestamp inherits the last one seen in its own source, so
  // it stays where it was written instead of sorting to the beginning.
  const inherited = new Map<string, string | null>()
  const keyed = tagged.map((entry) => {
    if (entry.line.timestamp !== null) inherited.set(entry.source, entry.line.timestamp)
    return { ...entry, key: entry.line.timestamp ?? inherited.get(entry.source) ?? '' }
  })

  keyed.sort((left, right) => {
    if (left.key !== right.key) return left.key < right.key ? -1 : 1
    // Stable within one source, and stable between sources by name, so two
    // reads of the same data produce the same screen.
    if (left.source !== right.source) return left.source < right.source ? -1 : 1
    return left.index - right.index
  })

  const truncated = keyed.length > limit
  const kept = truncated ? keyed.slice(keyed.length - limit) : keyed

  return {
    lines: kept.map((entry) => ({
      stream: entry.line.stream,
      timestamp: entry.line.timestamp,
      text: entry.line.text,
      service: entry.source,
    })),
    ordered,
    truncated,
  }
}
