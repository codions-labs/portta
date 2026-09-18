import type { TranscriptEntry } from './types.ts'

export type TranscriptItem =
  | { type: 'prompt'; key: string; text: string }
  | { type: 'text' | 'reasoning'; key: string; text: string }
  | {
      type: 'tool'
      key: string
      name: string
      input: unknown
      output: string | null
      failed: boolean
      running: boolean
    }
  | { type: 'status'; key: string; state: 'running' | 'done' | 'failed'; error: string | null }

export function buildTranscriptItems(entries: TranscriptEntry[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const tools = new Map<string, Extract<TranscriptItem, { type: 'tool' }>>()
  let lastTool: Extract<TranscriptItem, { type: 'tool' }> | null = null
  for (const entry of entries) {
    const chunk = entry.chunk
    const key = String(entry.cursor)
    if (chunk.kind === 'meta') {
      items.push({ type: 'prompt', key, text: chunk.prompt })
    } else if (chunk.kind === 'text' || chunk.kind === 'reasoning') {
      const previous = items.at(-1)
      if (previous?.type === chunk.kind) previous.text += chunk.text
      else items.push({ type: chunk.kind, key, text: chunk.text })
    } else if (chunk.kind === 'tool') {
      const item: Extract<TranscriptItem, { type: 'tool' }> = {
        type: 'tool',
        key,
        name: chunk.name,
        input: chunk.input,
        output: null,
        failed: false,
        running: true,
      }
      items.push(item)
      if (chunk.id) tools.set(chunk.id, item)
      lastTool = item
    } else if (chunk.kind === 'tool-result') {
      const target = chunk.id ? tools.get(chunk.id) : lastTool
      if (target) {
        target.output = chunk.output ?? null
        target.failed = chunk.isError === true
        target.running = false
        if (chunk.id) tools.delete(chunk.id)
      } else {
        items.push({
          type: 'tool',
          key,
          name: chunk.name ?? 'Result',
          input: null,
          output: chunk.output ?? null,
          failed: chunk.isError === true,
          running: false,
        })
      }
    } else {
      items.push({ type: 'status', key, state: chunk.state, error: chunk.error ?? null })
    }
  }
  return items
}
