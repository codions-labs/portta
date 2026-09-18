'use client'

// Mermaid rendered in the browser, on the documentation pages, not at build time.
//
// The image already ships a browser for this site. Bundling the library keeps
// the corpus offline: no CDN, no Puppeteer in the image, and a fence that
// fails to parse stays as the source a reader can still understand.

export async function renderMermaid(root: HTMLElement, dark: boolean, cancelled: () => boolean): Promise<void> {
  const pending: Array<{ source: string; node: Element }> = []
  for (const code of root.querySelectorAll('pre > code.language-mermaid')) {
    const pre = code.closest('pre')
    if (pre) pending.push({ source: code.textContent ?? '', node: pre })
  }
  const theme = dark ? 'dark' : 'neutral'
  for (const figure of root.querySelectorAll('figure.mermaid-diagram[data-source]')) {
    if (figure.querySelector('svg') && figure.getAttribute('data-theme') === theme) continue
    pending.push({ source: figure.getAttribute('data-source') ?? '', node: figure })
  }
  if (pending.length === 0 || cancelled()) return

  const { default: mermaid } = await import('mermaid')
  if (cancelled()) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'neutral',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  })

  for (const [index, { source, node }] of pending.entries()) {
    if (cancelled() || !source.trim()) continue
    const id = `portta-mermaid-${Date.now().toString(36)}-${index}`
    try {
      const { svg } = await mermaid.render(id, source)
      if (cancelled() || !node.isConnected) continue
      const figure = document.createElement('figure')
      figure.className = 'mermaid-diagram'
      figure.setAttribute('data-source', source)
      figure.setAttribute('data-theme', theme)
      figure.innerHTML = svg
      node.replaceWith(figure)
    } catch {
      // The fence stays. A labelled source is better than a hole.
    }
  }
}
