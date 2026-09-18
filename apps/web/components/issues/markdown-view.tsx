'use client'

import MarkdownIt from 'markdown-it'
import { useMemo } from 'react'
import { cn } from '../../lib/utils.ts'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })

markdown.use(gfmTables)

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]!.attrSet('target', '_blank')
  tokens[index]!.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, index, options, env, self)
}
markdown.renderer.rules.list_item_open = (tokens, index, options, _env, self) => {
  const close = tokens.findIndex((token, candidate) => candidate > index && token.type === 'list_item_close')
  const inline = tokens.slice(index + 1, close < 0 ? undefined : close).find((token) => token.type === 'inline')
  const match = inline?.content.match(/^\[([ xX])\]\s+/)
  if (match && inline) {
    inline.content = inline.content.slice(match[0].length)
    const firstText = inline.children?.find((token) => token.type === 'text')
    if (firstText) firstText.content = firstText.content.replace(/^\[([ xX])\]\s+/, '')
    return `<li class="task-list-item"><input type="checkbox" disabled${match[1]!.toLowerCase() === 'x' ? ' checked' : ''}>`
  }
  return self.renderToken(tokens, index, options)
}

function isSeparator(line: string): boolean {
  return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(line.trim())
}

function cellsOf(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function gfmTables(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'gfm_table', (state, startLine, endLine, silent) => {
    if (startLine + 1 >= endLine) return false
    const headerLine = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine])
    const separatorLine = state.src.slice(
      state.bMarks[startLine + 1]! + state.tShift[startLine + 1]!,
      state.eMarks[startLine + 1],
    )
    if (!headerLine.includes('|') || !isSeparator(separatorLine)) return false
    const header = cellsOf(headerLine)
    const alignments = cellsOf(separatorLine).map((cell) => {
      const left = cell.startsWith(':')
      const right = cell.endsWith(':')
      return left && right ? 'center' : right ? 'right' : left ? 'left' : ''
    })
    if (header.length === 0 || alignments.length === 0) return false
    if (silent) return true

    const rows: string[][] = []
    let next = startLine + 2
    while (next < endLine && !state.isEmpty(next)) {
      const line = state.src.slice(state.bMarks[next]! + state.tShift[next]!, state.eMarks[next])
      if (!line.includes('|') || isSeparator(line)) break
      rows.push(cellsOf(line))
      next += 1
    }

    const tableOpen = state.push('table_open', 'table', 1)
    tableOpen.map = [startLine, next]
    state.push('thead_open', 'thead', 1)
    state.push('tr_open', 'tr', 1)
    header.forEach((cell, index) => {
      const token = state.push('th_open', 'th', 1)
      if (alignments[index]) token.attrSet('style', `text-align:${alignments[index]}`)
      const inline = state.push('inline', '', 0)
      inline.content = cell
      inline.children = []
      state.push('th_close', 'th', -1)
    })
    state.push('tr_close', 'tr', -1)
    state.push('thead_close', 'thead', -1)
    if (rows.length > 0) {
      state.push('tbody_open', 'tbody', 1)
      for (const row of rows) {
        state.push('tr_open', 'tr', 1)
        header.forEach((_, index) => {
          const token = state.push('td_open', 'td', 1)
          if (alignments[index]) token.attrSet('style', `text-align:${alignments[index]}`)
          const inline = state.push('inline', '', 0)
          inline.content = row[index] ?? ''
          inline.children = []
          state.push('td_close', 'td', -1)
        })
        state.push('tr_close', 'tr', -1)
      }
      state.push('tbody_close', 'tbody', -1)
    }
    state.push('table_close', 'table', -1)
    state.line = next
    return true
  })
}

/** The single safe renderer used by reading mode and every editor preview. */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => markdown.render(source), [source])
  return (
    <div
      className={cn(
        'max-w-none text-sm leading-relaxed text-ink',
        '[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline',
        '[&_code]:rounded-sm [&_code]:border [&_code]:border-line [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em]',
        '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-2 [&_pre]:p-3 [&_pre]:text-xs [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_.task-list-item]:list-none [&_.task-list-item_input]:mr-2 [&_.task-list-item_input]:accent-accent',
        '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted',
        '[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
        '[&_del]:text-muted [&_s]:text-muted',
        '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs [&_th]:border [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium [&_th]:text-subtle [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1',
        '[&_p]:my-2 [&_hr]:my-4 [&_hr]:border-line',
        className,
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it output with raw HTML disabled (html: false above)
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
