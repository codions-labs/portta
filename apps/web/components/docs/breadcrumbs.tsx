import Link from 'next/link'
export function DocsBreadcrumbs({ section, category, title }: { section: string; category?: string; title: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-2">
        <li>
          <Link href="/docs" className="rounded hover:text-accent focus-ring">
            Documentation
          </Link>
        </li>
        {[section, category].filter(Boolean).map((label) => (
          <li key={label} className="flex items-center gap-2">
            <span aria-hidden>›</span>
            <span>{label}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span aria-hidden>›</span>
          <span aria-current="page">{title}</span>
        </li>
      </ol>
    </nav>
  )
}
