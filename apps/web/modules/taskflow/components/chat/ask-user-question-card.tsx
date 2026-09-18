'use client'

import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { formatAskUserQuestionAnswer } from '../../lib/ask-user-question.ts'
import type { AskUserQuestionInput } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'

interface AskUserQuestionCardProps {
  input: AskUserQuestionInput
  disabled: boolean
  onSubmit: (text: string) => void
}

export function AskUserQuestionCard({ input, disabled, onSubmit }: AskUserQuestionCardProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'chat.question' })
  const autoSend = input.questions.length === 1 && input.questions[0]?.multiSelect !== true
  const [selections, setSelections] = useState<Record<number, string[]>>({})
  const [customText, setCustomText] = useState<Record<number, string>>({})

  function buildAnswers(): Array<{ header: string; values: string[] }> {
    return input.questions.map((question, index) => {
      const custom = customText[index]?.trim() ?? ''
      const values = [...(selections[index] ?? [])]
      if (custom.length > 0) values.push(custom)
      return { header: question.header, values }
    })
  }

  const canSubmit = !disabled && buildAnswers().some((answer) => answer.values.length > 0)

  function submitSingle(header: string, value: string): void {
    onSubmit(formatAskUserQuestionAnswer([{ header, values: [value] }]))
  }

  function submitAll(): void {
    if (disabled) return
    const text = formatAskUserQuestionAnswer(buildAnswers())
    if (text.length > 0) onSubmit(text)
  }

  function toggleOption(questionIndex: number, label: string): void {
    if (disabled) return
    const question = input.questions[questionIndex]
    if (!question) return
    if (autoSend) {
      submitSingle(question.header, label)
      return
    }

    setSelections((currentSelections) => {
      const current = currentSelections[questionIndex] ?? []
      const next = question.multiSelect
        ? current.includes(label)
          ? current.filter((value) => value !== label)
          : [...current, label]
        : current.includes(label)
          ? []
          : [label]
      return { ...currentSelections, [questionIndex]: next }
    })
  }

  function handleCustomKeydown(event: KeyboardEvent<HTMLInputElement>, questionIndex: number): void {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (disabled) return
    const custom = customText[questionIndex]?.trim() ?? ''
    if (autoSend) {
      const question = input.questions[questionIndex]
      if (question && custom.length > 0) submitSingle(question.header, custom)
      return
    }
    if (canSubmit) submitAll()
  }

  return (
    <div className="w-full min-w-0 max-w-[94%] self-start overflow-hidden rounded-lg border border-accent/35 bg-accent/6 text-xs text-ink">
      <div className="border-b border-line px-3 py-2 text-2xs font-medium text-subtle">{t('title')}</div>
      <div className="flex flex-col gap-4 px-3 py-3">
        {input.questions.map((question, questionIndex) => (
          <div className="flex min-w-0 flex-col gap-2" key={`${question.header}:${question.question}`}>
            <div className="text-2xs font-medium text-subtle">{question.header}</div>
            <div className="text-sm text-ink">{question.question}</div>
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => {
                const selected = (selections[questionIndex] ?? []).includes(option.label)
                return (
                  <button
                    type="button"
                    key={option.label}
                    className={cn(
                      'min-w-0 max-w-full rounded-md border px-3 py-1.5 text-left transition-colors duration-100 focus-ring disabled:cursor-not-allowed disabled:opacity-60',
                      selected
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-line bg-surface text-ink enabled:hover:bg-fill',
                    )}
                    disabled={disabled}
                    onClick={() => toggleOption(questionIndex, option.label)}
                  >
                    <span className="block break-words font-medium">{option.label}</span>
                    {option.description ? (
                      <span
                        className={cn(
                          'mt-0.5 block break-words text-2xs',
                          selected ? 'text-accent-fg/80' : 'text-subtle',
                        )}
                      >
                        {option.description}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            <Input
              size="sm"
              type="text"
              placeholder={t('customPlaceholder')}
              value={customText[questionIndex] ?? ''}
              onChange={(event) =>
                setCustomText((current) => ({ ...current, [questionIndex]: event.currentTarget.value }))
              }
              onKeyDown={(event) => handleCustomKeydown(event, questionIndex)}
              disabled={disabled}
            />
          </div>
        ))}
      </div>
      {!autoSend ? (
        <div className="flex justify-end border-t border-line px-3 py-2">
          <Button size="sm" variant="primary" onClick={submitAll} disabled={!canSubmit}>
            {t('submit')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
