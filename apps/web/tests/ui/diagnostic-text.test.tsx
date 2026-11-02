import { screen } from '@testing-library/react'
import type { Diagnostic } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { DiagnosticText } from '@/components/diagnostic-text'
import { renderWithQuery } from './render.tsx'

const check: Diagnostic = {
  id: 'database',
  status: 'pass',
  title: 'Panel persistence',
  detail: '1 migration(s) applied',
  fix: '',
}

describe('DiagnosticText', () => {
  it('translates a title kept outside the status', () => {
    renderWithQuery(<DiagnosticText diagnostic={check} part="title" />, 'pt-BR')
    expect(screen.getByText('Persistência do painel')).toBeInTheDocument()
  })

  it('fills in the values it was sent', () => {
    renderWithQuery(<DiagnosticText diagnostic={{ ...check, params: { count: 3 } }} part="detail" />, 'pt-BR')
    expect(screen.getByText('3 migration(s) aplicada(s)')).toBeInTheDocument()
  })

  it('shows its own wording rather than a placeholder', () => {
    renderWithQuery(<DiagnosticText diagnostic={check} part="detail" />, 'pt-BR')
    expect(screen.getByText('1 migration(s) applied')).toBeInTheDocument()
  })

  it('falls back to its own wording for a check nobody translated', () => {
    renderWithQuery(
      <DiagnosticText diagnostic={{ ...check, id: 'nobody-knows', title: 'Mystery' }} part="title" />,
      'pt-BR',
    )
    expect(screen.getByText('Mystery')).toBeInTheDocument()
  })
})
