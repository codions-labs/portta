// One engine, one question: which file.

import { describe, expect, it } from 'vitest'
import { composeFiles, loadGatewayConfig } from './config.ts'
import { DATABASE_CONTAINER_PATH, databaseFileFor, databaseFiles, resolveDatabase } from './database-config.ts'

describe('where the panel database is', () => {
  it('follows the installation root when nothing set the variable', () => {
    expect(resolveDatabase({}, '/home/dev/portta').path).toBe('/home/dev/portta/state/panel/portta.db')
    expect(databaseFileFor('/srv/portta')).toBe('/srv/portta/state/panel/portta.db')
  })

  // A panel without the variable is a misconfigured container, not one that
  // should invent a path under whatever its working directory happens to be.
  it('falls back to the documented container path, never to a relative one', () => {
    expect(resolveDatabase({}).path).toBe(DATABASE_CONTAINER_PATH)
    expect(resolveDatabase({}).path.startsWith('/')).toBe(true)
  })

  it('lets the environment win, because the container and the host see different roots', () => {
    expect(
      resolveDatabase({ PORTTA_RUNTIME_DATABASE_FILE: '/app/state/panel/portta.db' }, '/home/dev/portta').path,
    ).toBe('/app/state/panel/portta.db')
  })

  // In WAL mode a database is three files, and copying only the first one is
  // how a backup silently loses the most recent writes.
  it('names all three files a WAL database is', () => {
    expect(databaseFiles('/x/portta.db')).toEqual(['/x/portta.db', '/x/portta.db-wal', '/x/portta.db-shm'])
  })

  it('selects no database service: there is no container to select', () => {
    const files = composeFiles(loadGatewayConfig({ PORTTA_WEB: 'true' }))
    expect(files).toContain('docker/compose/features/web.yaml')
    expect(files).not.toContain('docker/compose/features/db.yaml')
  })
})
