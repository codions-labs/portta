import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { NextResponse } from 'next/server'
import { repositoryRoot } from '@/lib/docs/bundle'
import { hasDeps, serverDeps } from '@/lib/server/deps'

const SAFE_NAME = /^[A-Za-z0-9._-]+$/

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function contentType(name: string): string {
  const dot = name.lastIndexOf('.')
  return TYPES[dot >= 0 ? name.slice(dot).toLowerCase() : ''] ?? 'application/octet-stream'
}

/**
 * Screenshots that ship with the corpus. The collector rewrites Markdown
 * images under `docs/images/` to this route, so a page never fetches a host.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (hasDeps() && !serverDeps().config.docs) {
    return new NextResponse(null, { status: 404 })
  }

  const { name } = await params
  if (!SAFE_NAME.test(name) || basename(name) !== name) {
    return new NextResponse(null, { status: 404 })
  }

  const directory = resolve(repositoryRoot(), 'docs', 'images')
  const file = resolve(directory, name)
  if (!file.startsWith(`${directory}/`)) {
    return new NextResponse(null, { status: 404 })
  }

  try {
    const body = await readFile(file)
    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType(name),
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
