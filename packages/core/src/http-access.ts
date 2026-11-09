// Persistent HTTP attachment decisions belong to the API. The CLI reads this
// bounded intent and projects it into generated Compose state.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const HTTP_ACCESS_FILE = 'state/runner/http-access.json'
export const HTTP_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface HttpAccessStore {
  version: 1
  attachments: Array<{ project: string; service: string }>
}

export interface HttpAccessOperation {
  requestId: string
  project: string
  service: string
  port: number
  state: 'pending' | 'running' | 'ok' | 'failed'
  error: string | null
}

export function httpAccessName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value)
}

export function parseHttpAccessStore(text: string): HttpAccessStore {
  const value = JSON.parse(text) as Partial<HttpAccessStore> | null
  if (value?.version !== 1 || !Array.isArray(value.attachments)) throw new Error('invalid HTTP access store')
  const seen = new Set<string>()
  const attachments = value.attachments.map((item) => {
    if (!item || !httpAccessName(item.project) || !httpAccessName(item.service))
      throw new Error('invalid HTTP attachment identity')
    const key = `${item.project}\0${item.service}`
    if (seen.has(key)) throw new Error('duplicate HTTP attachment')
    seen.add(key)
    return { project: item.project, service: item.service }
  })
  return { version: 1, attachments }
}

export function readHttpAccessStore(path: string): HttpAccessStore {
  return existsSync(path) ? parseHttpAccessStore(readFileSync(path, 'utf8')) : { version: 1, attachments: [] }
}

export function httpAccessOverlayPath(root: string, project: string): string {
  if (!httpAccessName(project)) throw new Error('invalid HTTP attachment project')
  return join(root, 'runtime', 'compose', 'http-access', `${project}.yaml`)
}

export function httpAccessOperationPath(root: string, requestId: string): string {
  if (!HTTP_REQUEST_ID.test(requestId)) throw new Error('invalid HTTP integration request id')
  return join(root, 'state', 'runner', 'http-operations', `${requestId}.json`)
}
