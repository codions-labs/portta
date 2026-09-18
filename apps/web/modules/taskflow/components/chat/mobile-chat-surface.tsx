'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTaskflowProject } from '../../lib/project.tsx'
import type {
  AgentsUiConversationEvent,
  AgentsUiConversationState,
  AgentsUiWorktreeConversationResponse,
  WorktreeInfo,
} from '../../lib/types.ts'
import { errorMessage } from '../../lib/utils.ts'
import {
  applyConversationMessageDelta,
  applyConversationMessageUpsert,
  applyConversationStatus,
  buildConversationProgressSignature,
  markConversationTurnStarted,
  mergeConversationSnapshot,
} from '../../lib/worktree-conversation.ts'
import { WorktreeConversationPanel } from './worktree-conversation-panel.tsx'

interface MobileChatSurfaceProps {
  worktree: WorktreeInfo
  onConversationMessageSent?: () => void
}

interface RefreshPollingState {
  token: number
  baselineSignature: string | null
  lastSignature: string | null
  sawProgress: boolean
  unchangedTicks: number
  stopWhenIdle: boolean
}

const REFRESH_POLL_INTERVAL_MS = 1000
const REFRESH_POLL_SETTLE_TICKS = 3

export function MobileChatSurface({ worktree, onConversationMessageSent = () => {} }: MobileChatSurfaceProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'chat.stream' })
  const { api } = useTaskflowProject()
  const [conversation, setConversationState] = useState<AgentsUiConversationState | null>(null)
  const [conversationError, setConversationError] = useState<string | null>(null)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [composerText, setComposerText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isAnsweringQuestion, setIsAnsweringQuestion] = useState(false)
  const [refreshPollingState, setRefreshPollingState] = useState<RefreshPollingState | null>(null)
  const conversationRef = useRef<AgentsUiConversationState | null>(null)
  const pollingRef = useRef<RefreshPollingState | null>(null)
  const streamConnection = useRef<{ conversationId: string; disconnect: () => void } | null>(null)
  const nextRefreshPollingToken = useRef(1)
  const lastStreamRevision = useRef(0)

  function updateConversation(next: AgentsUiConversationState | null): void {
    conversationRef.current = next
    setConversationState(next)
  }

  function updatePolling(next: RefreshPollingState | null): void {
    pollingRef.current = next
    setRefreshPollingState(next)
  }

  const closeConversationStream = useCallback((): void => {
    streamConnection.current?.disconnect()
    streamConnection.current = null
    lastStreamRevision.current = 0
  }, [])

  function supportsStreaming(next: AgentsUiConversationState | null): boolean {
    return next?.provider === 'codexAppServer' || next?.provider === 'claudeCode'
  }

  function hasActiveConversationStream(conversationId: string): boolean {
    return streamConnection.current?.conversationId === conversationId
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: stream callbacks read synchronized refs and must retain connection identity
  const syncConversationStream = useCallback(
    (force = false): void => {
      const current = conversationRef.current
      const conversationId = supportsStreaming(current) ? (current?.conversationId ?? null) : null
      if (streamConnection.current && streamConnection.current.conversationId !== conversationId)
        closeConversationStream()
      if (!conversationId || hasActiveConversationStream(conversationId) || (!force && current?.running !== true))
        return

      lastStreamRevision.current = 0
      const handleFailure = (message: string): void => {
        if (!hasActiveConversationStream(conversationId) || !streamConnection.current) return
        const currentConnection = streamConnection.current
        streamConnection.current = null
        currentConnection.disconnect()
        setConversationError(message)
      }
      const handleEvent = (event: AgentsUiConversationEvent): void => {
        if (!hasActiveConversationStream(conversationId)) return
        if (event.type !== 'error') {
          if (event.revision <= lastStreamRevision.current) return
          lastStreamRevision.current = event.revision
        }
        const currentConversation = conversationRef.current
        if (event.type === 'messageDelta') updateConversation(applyConversationMessageDelta(currentConversation, event))
        else if (event.type === 'messageUpsert')
          updateConversation(applyConversationMessageUpsert(currentConversation, event))
        else if (event.type === 'conversationStatus') {
          updateConversation(applyConversationStatus(currentConversation, event))
          queueMicrotask(() => syncConversationStream())
        } else setConversationError(event.message)
      }
      const disconnect = api.connectWorktreeConversationStream(worktree.branch, {
        onEvent: handleEvent,
        onError: (reason) => handleFailure(reason === 'malformed' ? t('malformed') : t('connectionFailed')),
        onClose: () => handleFailure(t('disconnected')),
      })
      streamConnection.current = { conversationId, disconnect }
    },
    [api, closeConversationStream, t, worktree.branch],
  )

  function requestConversation(mode: 'attach' | 'history'): Promise<AgentsUiWorktreeConversationResponse> {
    return mode === 'attach'
      ? api.attachWorktreeConversation(worktree.branch)
      : api.fetchWorktreeConversationHistory(worktree.branch)
  }

  function applyConversationResponse(response: AgentsUiWorktreeConversationResponse): void {
    updateConversation(mergeConversationSnapshot(conversationRef.current, response.conversation))
    setConversationError(null)
    queueMicrotask(() => syncConversationStream())
  }

  async function loadConversation(mode: 'attach' | 'history'): Promise<void> {
    setConversationLoading(true)
    setConversationError(null)
    try {
      applyConversationResponse(await requestConversation(mode))
    } catch (caught) {
      setConversationError(errorMessage(caught))
    } finally {
      setConversationLoading(false)
    }
  }

  function startRefreshPolling(baseline = conversationRef.current, stopWhenIdle = false): void {
    const signature = buildConversationProgressSignature(baseline)
    updatePolling({
      token: nextRefreshPollingToken.current++,
      baselineSignature: signature,
      lastSignature: signature,
      sawProgress: false,
      unchangedTicks: 0,
      stopWhenIdle,
    })
  }

  function updateRefreshPolling(token: number, nextConversation: AgentsUiConversationState): void {
    const current = pollingRef.current
    if (!current || current.token !== token || current.stopWhenIdle) return
    const nextSignature = buildConversationProgressSignature(nextConversation)
    const sawProgress = current.sawProgress || nextSignature !== current.baselineSignature
    const unchangedTicks = nextSignature === current.lastSignature ? current.unchangedTicks + 1 : 0
    if (sawProgress && unchangedTicks >= REFRESH_POLL_SETTLE_TICKS) updatePolling(null)
    else updatePolling({ ...current, lastSignature: nextSignature, sawProgress, unchangedTicks })
  }

  async function sendConversationText(text: string): Promise<boolean> {
    const current = conversationRef.current
    if (!current) return false
    const trimmed = text.trim()
    if (trimmed.length === 0) return false
    setIsSending(true)
    setConversationError(null)
    try {
      syncConversationStream(true)
      const response = await api.sendWorktreeConversationMessage(worktree.branch, { text: trimmed })
      let nextConversation = conversationRef.current
      if (!nextConversation) return false
      if (nextConversation.conversationId !== response.conversationId)
        nextConversation = { ...nextConversation, conversationId: response.conversationId }
      updateConversation(markConversationTurnStarted(nextConversation, response.turnId, trimmed))
      if (response.streaming) syncConversationStream()
      else {
        closeConversationStream()
        startRefreshPolling(current)
      }
      onConversationMessageSent()
      return true
    } catch (caught) {
      setConversationError(errorMessage(caught))
      return false
    } finally {
      setIsSending(false)
    }
  }

  async function sendSelectedConversationMessage(): Promise<void> {
    if (composerText.trim().length === 0) return
    if (await sendConversationText(composerText)) setComposerText('')
  }

  async function interruptSelectedConversation(): Promise<void> {
    const baseline = conversationRef.current
    setConversationError(null)
    try {
      const response = await api.interruptWorktreeConversation(worktree.branch)
      if (response.streaming) syncConversationStream()
      else {
        closeConversationStream()
        startRefreshPolling(baseline)
      }
    } catch (caught) {
      setConversationError(errorMessage(caught))
    }
  }

  async function answerConversationQuestion(text: string): Promise<void> {
    if (!conversationRef.current || isSending || isAnsweringQuestion) return
    setIsAnsweringQuestion(true)
    try {
      if (conversationRef.current.running) await interruptSelectedConversation()
      await sendConversationText(text)
    } finally {
      setIsAnsweringQuestion(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stable mount effect loads once for this keyed worktree surface
  useEffect(() => {
    void loadConversation('attach')
    return closeConversationStream
  }, [closeConversationStream])

  // biome-ignore lint/correctness/useExhaustiveDependencies: polling helpers synchronize their own refs
  useEffect(() => {
    const terminalOwnedClaudeTurn = conversation?.provider === 'claudeCode' && conversation.running !== true
    if (worktree.agent === 'working' && terminalOwnedClaudeTurn) {
      if (pollingRef.current === null) startRefreshPolling(conversation, true)
    } else if (pollingRef.current?.stopWhenIdle === true) updatePolling(null)
  }, [conversation, worktree.agent])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the token owns the interval lifecycle and helpers read synchronized refs
  useEffect(() => {
    if (!refreshPollingState) return
    const token = refreshPollingState.token
    let requestInFlight = false
    const interval = window.setInterval(() => {
      if (!pollingRef.current || pollingRef.current.token !== token || requestInFlight) return
      requestInFlight = true
      void requestConversation('history')
        .then((response) => {
          applyConversationResponse(response)
          updateRefreshPolling(token, response.conversation)
        })
        .catch((caught: unknown) => {
          setConversationError(errorMessage(caught))
        })
        .finally(() => {
          requestInFlight = false
        })
    }, REFRESH_POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [refreshPollingState?.token])

  return (
    <WorktreeConversationPanel
      worktree={worktree}
      conversation={conversation}
      conversationError={conversationError}
      conversationLoading={conversationLoading}
      composerText={composerText}
      isSending={isSending}
      onAttach={() => void loadConversation('attach')}
      onComposerInput={setComposerText}
      onInterrupt={() => void interruptSelectedConversation()}
      onRefresh={() => void loadConversation('history')}
      onSend={() => void sendSelectedConversationMessage()}
      onAnswerQuestion={(text) => void answerConversationQuestion(text)}
    />
  )
}
