'use client'

import { CornerDownLeft, Loader2, Square } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ASK_USER_QUESTION_TOOL_NAME, parseAskUserQuestion } from '../../lib/ask-user-question.ts'
import type {
  AgentsUiConversationMessage,
  AgentsUiConversationState,
  AskUserQuestionInput,
  WorktreeInfo,
} from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import { AskUserQuestionCard } from './ask-user-question-card.tsx'

interface WorktreeConversationPanelProps {
  worktree: WorktreeInfo
  conversation: AgentsUiConversationState | null
  conversationError: string | null
  conversationLoading: boolean
  composerText: string
  isSending: boolean
  onAttach: () => void
  onComposerInput: (value: string) => void
  onInterrupt: () => void
  onRefresh: () => void
  onSend: () => void
  onAnswerQuestion: (text: string) => void
}

type TranscriptItem =
  | { type: 'message'; key: string; message: AgentsUiConversationMessage }
  | { type: 'question'; key: string; tool: AgentsUiConversationMessage; input: AskUserQuestionInput; answered: boolean }
  | { type: 'tool'; key: string; tool: AgentsUiConversationMessage; result: AgentsUiConversationMessage | null }

function messageKind(message: AgentsUiConversationMessage): NonNullable<AgentsUiConversationMessage['kind']> {
  return message.kind ?? 'text'
}

function isVisibleTranscriptMessage(message: AgentsUiConversationMessage): boolean {
  const kind = messageKind(message)
  return !((kind === 'text' || kind === 'thinking') && message.text.trim().length === 0)
}

function buildTranscriptItems(messages: AgentsUiConversationMessage[]): TranscriptItem[] {
  const toolUseCallIds = new Set<string>()
  const resultByCallId = new Map<string, AgentsUiConversationMessage>()
  for (const message of messages) {
    if (messageKind(message) === 'toolUse' && message.toolCallId) toolUseCallIds.add(message.toolCallId)
    if (messageKind(message) === 'toolResult' && message.toolCallId && !resultByCallId.has(message.toolCallId))
      resultByCallId.set(message.toolCallId, message)
  }

  return messages.flatMap((message): TranscriptItem[] => {
    const kind = messageKind(message)
    if (kind === 'toolUse') {
      if (message.toolName === ASK_USER_QUESTION_TOOL_NAME) {
        const input = parseAskUserQuestion(message.text)
        if (input) {
          const answered = messages.some(
            (other) => other.role === 'user' && messageKind(other) === 'text' && other.order > message.order,
          )
          return [{ type: 'question', key: message.id, tool: message, input, answered }]
        }
      }
      return [
        {
          type: 'tool',
          key: message.id,
          tool: message,
          result: message.toolCallId ? (resultByCallId.get(message.toolCallId) ?? null) : null,
        },
      ]
    }
    if (kind === 'toolResult' && message.toolCallId && toolUseCallIds.has(message.toolCallId)) return []
    return [{ type: 'message', key: message.id, message }]
  })
}

function toolStatusKey(message: AgentsUiConversationMessage): 'running' | 'failed' | 'completed' {
  if (message.status === 'inProgress') return 'running'
  if (message.status === 'failed') return 'failed'
  return 'completed'
}

function formatDuration(durationMs: number | null | undefined): string | null {
  if (durationMs === null || durationMs === undefined) return null
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
}

function ProcessingIndicator({ agentLabel }: { agentLabel: string }) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'chat' })
  return (
    <div className="flex max-w-[88%] items-center gap-2 self-start rounded-md border border-line bg-surface px-3 py-2 text-xs text-subtle">
      <Loader2 aria-hidden className="size-3 animate-spin" />
      {t('processing', { agent: agentLabel })}
    </div>
  )
}

export function WorktreeConversationPanel(props: WorktreeConversationPanelProps) {
  const {
    worktree,
    conversation,
    conversationError,
    conversationLoading,
    composerText,
    isSending,
    onAttach,
    onComposerInput,
    onInterrupt,
    onRefresh,
    onSend,
    onAnswerQuestion,
  } = props
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'chat' })
  const transcriptViewport = useRef<HTMLDivElement>(null)
  const agentLabel = worktree.agentLabel ?? (worktree.agentName === 'claude' ? 'Claude' : 'Codex')
  const supportsAgentChat = worktree.agentName === 'codex' || worktree.agentName === 'claude'
  const chatAvailable = supportsAgentChat && worktree.mux === '✓'
  const showInterrupt = chatAvailable && (conversation?.running ?? false)
  const showComposerInterrupt = showInterrupt && !conversationError
  const showProcessingIndicator = isSending || showComposerInterrupt
  const transcriptItems = useMemo(
    () => buildTranscriptItems((conversation?.messages ?? []).filter(isVisibleTranscriptMessage)),
    [conversation?.messages],
  )
  const canSend =
    chatAvailable &&
    conversation !== null &&
    !conversationLoading &&
    composerText.trim().length > 0 &&
    !isSending &&
    !(conversation?.running ?? false)
  useEffect(() => {
    if (!conversation?.conversationId || !transcriptViewport.current) return
    transcriptViewport.current.scrollTo({ top: transcriptViewport.current.scrollHeight, behavior: 'auto' })
  }, [conversation])

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (canSend) onSend()
  }

  if (!supportsAgentChat)
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-subtle">
        {t('unavailable')}
      </div>
    )
  if (!chatAvailable)
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-subtle">
        {t('openFirst')}
      </div>
    )

  const emptyState = (
    <div className="rounded-md border border-line bg-surface px-4 py-5 text-sm text-subtle">{t('empty')}</div>
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      {conversationError ? (
        <div
          className="mx-4 mt-4 rounded-md border border-danger/35 bg-danger/6 px-4 py-3 text-sm text-ink"
          role="alert"
        >
          <div>{conversationError}</div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={conversation ? onRefresh : onAttach} disabled={conversationLoading || isSending}>
              {conversation ? t('reconnect') : t('attach')}
            </Button>
            {showInterrupt ? (
              <Button size="sm" variant="danger" onClick={onInterrupt}>
                {t('interrupt')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
        <div
          ref={transcriptViewport}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1 pb-4 scroll-thin"
        >
          {conversationLoading && !conversation ? (
            <div className="rounded-md border border-line bg-surface px-4 py-5 text-sm text-subtle">
              {t('connecting', { agent: agentLabel })}
            </div>
          ) : !conversation ? (
            emptyState
          ) : conversation.messages.length === 0 ? (
            showProcessingIndicator ? (
              <ProcessingIndicator agentLabel={agentLabel} />
            ) : (
              emptyState
            )
          ) : (
            <>
              {transcriptItems.map((item) => {
                if (item.type === 'question')
                  return (
                    <AskUserQuestionCard
                      key={item.key}
                      input={item.input}
                      disabled={item.answered}
                      onSubmit={onAnswerQuestion}
                    />
                  )
                if (item.type === 'tool') {
                  const message = item.tool
                  const result = item.result
                  const failed = message.status === 'failed' || result?.status === 'failed'
                  const faded = message.text.split('\n').length > 2 || message.text.length > 160
                  const exitCode = message.exitCode === null || message.exitCode === undefined ? null : message.exitCode
                  return (
                    <details
                      className={cn(
                        'group min-w-0 max-w-[94%] self-start rounded-md border text-xs text-ink',
                        failed ? 'border-danger/35 bg-danger/6' : 'border-line bg-surface-2/60',
                      )}
                      open={failed}
                      key={item.key}
                    >
                      <summary className="cursor-pointer px-3 py-2 text-subtle">
                        <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs font-medium">
                          <span>
                            {t(`tool.${toolStatusKey(message)}`, { name: message.toolName ?? t('tool.fallbackName') })}
                          </span>
                          {exitCode !== null ? <span>{t('tool.exit', { code: exitCode })}</span> : null}
                          {formatDuration(message.durationMs) ? (
                            <span>{formatDuration(message.durationMs)}</span>
                          ) : null}
                        </div>
                        <div className="relative mt-1 max-h-[2.05rem] overflow-hidden group-open:hidden">
                          <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-[1.35] text-muted">
                            {message.text}
                          </pre>
                          {faded ? (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-b from-transparent to-surface-2" />
                          ) : null}
                        </div>
                      </summary>
                      <div className="border-t border-line px-3 py-2">
                        <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-ink">
                          {message.text}
                        </pre>
                        {message.status === 'inProgress' ? (
                          <div className="mt-2 text-2xs font-medium text-subtle">{t('tool.runningNote')}</div>
                        ) : null}
                        {result ? (
                          <div className="mt-3 border-t border-line pt-2">
                            <div className="mb-1 text-2xs font-medium text-subtle">{t('tool.output')}</div>
                            <pre className="max-h-[18rem] overflow-auto whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-ink">
                              {result.text}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  )
                }
                const message = item.message
                if (messageKind(message) === 'thinking')
                  return (
                    <div
                      className="min-w-0 max-w-[88%] self-start rounded-md border border-line bg-surface-2/60 px-3 py-2 text-xs text-subtle"
                      key={item.key}
                    >
                      <div className="mb-1 font-medium">{t('thinking')}</div>
                      <div className="whitespace-pre-wrap break-words text-muted">{message.text}</div>
                      {message.status === 'inProgress' ? <div className="mt-2 font-medium">{t('working')}</div> : null}
                    </div>
                  )
                return (
                  <div
                    className={cn(
                      'min-w-0 max-w-[88%] rounded-2xl px-4 py-3 text-sm',
                      message.role === 'user'
                        ? 'self-end bg-accent text-accent-fg'
                        : 'self-start border border-line bg-surface text-ink',
                    )}
                    key={item.key}
                  >
                    <div className="whitespace-pre-wrap break-words">{message.text}</div>
                  </div>
                )
              })}
              {showProcessingIndicator ? <ProcessingIndicator agentLabel={agentLabel} /> : null}
            </>
          )}
        </div>
      </div>
      <div className="border-t border-line bg-surface px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        <div className="relative">
          <textarea
            id="conversation-composer"
            aria-label={t('message')}
            className="block min-h-[5.25rem] w-full max-w-full resize-none rounded-xl border border-line bg-surface py-3 pr-14 pl-4 text-sm text-ink transition-colors duration-100 placeholder:text-faint hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none"
            placeholder={t('placeholder')}
            value={composerText}
            onChange={(event) => onComposerInput(event.currentTarget.value)}
            onKeyDown={handleComposerKeyDown}
            disabled={isSending}
          />
          {showComposerInterrupt ? (
            <Button
              size="icon-md"
              variant="ghost"
              aria-label={t('interrupt')}
              className="absolute top-1/2 right-3 -translate-y-1/2"
              onClick={onInterrupt}
            >
              <Square />
            </Button>
          ) : (
            <Button
              size="icon-md"
              variant="ghost"
              aria-label={t('send')}
              className="absolute top-1/2 right-3 -translate-y-1/2"
              onClick={onSend}
              disabled={!canSend}
            >
              <CornerDownLeft />
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
