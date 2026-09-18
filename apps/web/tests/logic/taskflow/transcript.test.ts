// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildTranscriptItems } from '@/modules/taskflow/lib/transcript'

describe('buildTranscriptItems', () => {
  it('pairs parallel-safe tool ids and coalesces streamed text', () => {
    const items = buildTranscriptItems([
      { cursor: 1, chunk: { t: 1, kind: 'text', text: 'Found ' } },
      { cursor: 2, chunk: { t: 2, kind: 'text', text: 'it' } },
      { cursor: 3, chunk: { t: 3, kind: 'tool', id: 'a', name: 'read', input: { path: 'a.ts' } } },
      { cursor: 4, chunk: { t: 4, kind: 'tool', id: 'b', name: 'read', input: { path: 'b.ts' } } },
      { cursor: 5, chunk: { t: 5, kind: 'tool-result', id: 'a', output: 'A' } },
      { cursor: 6, chunk: { t: 6, kind: 'tool-result', id: 'b', output: 'B', isError: true } },
    ])

    expect(items[0]).toEqual({ type: 'text', key: '1', text: 'Found it' })
    expect(items[1]).toMatchObject({ type: 'tool', name: 'read', output: 'A', failed: false, running: false })
    expect(items[2]).toMatchObject({ type: 'tool', name: 'read', output: 'B', failed: true, running: false })
  })
})
