import { screen, waitFor } from '@testing-library/react'
import { docsHref, slugFor, splitDocRefs } from 'portta-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from './render.tsx'

const overview = vi.fn()

vi.mock('@/lib/api/index', () => ({
  ApiError: class ApiError extends Error {},
  api: { overview: () => overview() },
}))

const { DocText } = await import('@/components/doc-text')

function status(docs: boolean) {
  return { gateway: { panel: { docs } } }
}

beforeEach(() => {
  overview.mockReset().mockResolvedValue(status(true))
})

describe('docsHref', () => {
  it('keeps a section anchor on a settings citation', () => {
    expect(docsHref('docs/product/concepts/addresses-and-access.md#the-panel')).toBe(
      '/docs/addresses-and-access#the-panel',
    )
  })

  it('maps a repository path to the documentation route', () => {
    expect(docsHref('docs/development/adr/0031-projects-home-and-project.md')).toBe(
      '/docs/adr/0031-projects-home-and-project',
    )
    expect(docsHref('docs/product/guides/github.md')).toBe('/docs/github')
    expect(slugFor('docs/development/adr/README.md')).toBe('adr')
  })

  it('maps the documentation HTTP paths the settings copy already uses', () => {
    expect(docsHref('/docs')).toBe('/docs/')
    expect(docsHref('/docs/')).toBe('/docs/')
    expect(docsHref('/docs/api')).toBe('/docs/api')
  })
})

describe('splitDocRefs', () => {
  it('keeps the anchor on a markdown citation', () => {
    expect(splitDocRefs('See docs/product/concepts/addresses-and-access.md#the-panel.')).toEqual([
      { text: 'See ', href: null },
      { text: 'docs/product/concepts/addresses-and-access.md#the-panel', href: '/docs/addresses-and-access#the-panel' },
      { text: '.', href: null },
    ])
  })

  it('does not let /docs eat /docs/api', () => {
    const parts = splitDocRefs('the console at /docs/api.')
    expect(parts.some((part) => part.href === '/docs/api')).toBe(true)
    expect(parts.some((part) => part.text === '/docs/api')).toBe(true)
  })
})

describe('DocText', () => {
  it('turns a documentation path into a deep link', async () => {
    renderWithQuery(<DocText>See docs/development/adr/0031-projects-home-and-project.md.</DocText>)
    const link = await screen.findByRole('link', { name: 'docs/development/adr/0031-projects-home-and-project.md' })
    expect(link).toHaveAttribute('href', '/docs/adr/0031-projects-home-and-project')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('stays plain text when the panel does not serve the documentation', async () => {
    overview.mockResolvedValue(status(false))
    renderWithQuery(<DocText>See docs/product/guides/github.md.</DocText>)
    await waitFor(() => {
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
    expect(screen.getByText('See docs/product/guides/github.md.')).toBeInTheDocument()
  })
})
