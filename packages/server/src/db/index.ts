// The panel's persistence: one SQLite connection, one migrator, seven
// repositories over it.
//
// The schema and the client are portta-db; the rules are here. Every id crosses
// this boundary as a string and every timestamp as a Date, because that is what
// the services and the routes above have always been written against — the
// database's own integer rowid stays inside.
//
// Nothing here is async any more, and the signatures are still promises. SQLite
// through better-sqlite3 is synchronous, so a repository returns a value the
// moment it is called — but every caller in the panel awaits, and rewriting
// hundreds of call sites to drop an await that costs nothing would be a change
// with no behaviour in it.

import { appliedMigrations, createDb, type Db, migrateWithLock, seedMinimal } from 'portta-db'
import { ActivityRepository } from './activity.ts'
import { EnvironmentsRepository } from './environments.ts'
import { ProjectsRepository } from './projects.ts'
import { RepositoriesRepository } from './repositories.ts'
import { SettingsRepository } from './settings.ts'
import { SshKeysRepository } from './ssh-keys.ts'
import { WorkSessionsRepository } from './work-sessions.ts'

export interface DatabaseStatus {
  configured: boolean
  available: boolean
  reason: string | null
  checkedAt: number | null
  migrations: string[]
}

/** A connection problem, not a schema problem: the caller may retry. */
export class DatabaseUnavailable extends Error {
  readonly status = 503

  constructor(message = 'panel persistence is unavailable') {
    super(message)
    this.name = 'DatabaseUnavailable'
  }
}

/**
 * How a Database reaches the server it is backed by.
 *
 * `Database.open` builds these over a SQLite file and the real migrator. A
 * suite builds them over an in-memory database that is already migrated when it
 * is handed over — so the migration strategy is a dependency of this class
 * rather than something baked into it, and neither side needs a stand-in for
 * the other.
 */
export interface DatabaseBackend {
  /**
   * Apply pending migrations and make the database a Portta.
   *
   * Both, because both are "bring this file up to date" and a caller that could
   * do one without the other would be a caller that could leave an installation
   * migrated but identity-less — which is the state SSH keys refuse to work in.
   * Called at boot and by POST /api/database/migrate.
   */
  migrate: () => Promise<void>
  /** Which migrations this database has, newest last. */
  applied: () => Promise<string[]>
  ping: () => Promise<void>
  close: () => Promise<void>
}

export class Database {
  /**
   * The Drizzle handle itself, for Better Auth.
   *
   * Every other consumer goes through a repository, which is what keeps the
   * queries in one place. Better Auth is the exception on purpose: it owns its
   * own tables and issues its own statements through an adapter, so handing it
   * a repository would mean reimplementing the library.
   */
  readonly handle: Db

  readonly environments: EnvironmentsRepository
  readonly projects: ProjectsRepository
  readonly repositories: RepositoriesRepository
  readonly settings: SettingsRepository
  readonly sessions: WorkSessionsRepository
  readonly activity: ActivityRepository
  readonly sshKeys: SshKeysRepository

  private readonly backend: DatabaseBackend
  private initializing: Promise<void> | null = null
  private state: DatabaseStatus = {
    configured: true,
    available: false,
    reason: 'not checked yet',
    checkedAt: null,
    migrations: [],
  }

  constructor(db: Db, backend: DatabaseBackend) {
    this.backend = backend
    this.handle = db
    this.environments = new EnvironmentsRepository(db)
    this.projects = new ProjectsRepository(db)
    this.repositories = new RepositoriesRepository(db)
    this.settings = new SettingsRepository(db)
    this.sessions = new WorkSessionsRepository(db)
    this.activity = new ActivityRepository(db)
    this.sshKeys = new SshKeysRepository(db)
  }

  static open(path: string): Database {
    const { db, sql } = createDb(path)
    return new Database(db, {
      // The identity row, which nothing else creates.
      //
      // `instance` is what ADR 0013 calls this installation, and SSH keys hang
      // off it: `ssh_keys.instance_id` references it, so creating a key on an
      // installation without the row failed with "the Portta instance identity
      // is missing". Migrations do not write rows and `seedMinimal` had only
      // ever been called from tests, so no real installation had one. It is an
      // upsert on the singleton, so a database that already has it is untouched.
      migrate: async () => {
        migrateWithLock(path)
        seedMinimal(db)
      },
      applied: async () => appliedMigrations(sql),
      ping: async () => void sql.prepare('SELECT 1').get(),
      close: async () => {
        sql.close()
      },
    })
  }

  /**
   * A database opened for a test: an in-memory SQLite, migrated by
   * `createTestDb()`, with nothing to close and nothing to migrate.
   */
  static forTesting(db: Db): Database {
    return new Database(db, {
      migrate: async () => undefined,
      applied: async () => ['0000_current'],
      ping: async () => undefined,
      close: async () => undefined,
    })
  }

  async initialize(): Promise<void> {
    if (this.initializing !== null) return this.initializing
    this.initializing = this.initializeOnce().finally(() => {
      this.initializing = null
    })
    return this.initializing
  }

  private async initializeOnce(): Promise<void> {
    try {
      await this.backend.migrate()
      await this.backend.ping()
      this.markAvailable(await this.backend.applied())
    } catch (error) {
      this.markUnavailable(error)
      throw error
    }
  }

  /**
   * Apply every pending migration, even though boot already did: a file that
   * appeared after boot (the development bind-mount) is otherwise invisible
   * until the next restart.
   */
  async applyMigrations(): Promise<{ migrations: string[]; applied: string[] }> {
    const before = new Set(this.state.migrations)
    try {
      await this.backend.migrate()
      await this.backend.ping()
      const migrations = await this.backend.applied()
      this.markAvailable(migrations)
      return { migrations, applied: migrations.filter((tag) => !before.has(tag)) }
    } catch (error) {
      this.markUnavailable(error)
      throw new DatabaseUnavailable(error instanceof Error ? error.message : String(error))
    }
  }

  async recordEnvironmentsSeen(
    environments: ReadonlyArray<{
      name: string
      workingDir: string | null
      repoUrl: string | null
      gitRoot: string | null
      /** The Compose files Docker recorded; remembered so `up` can run once the containers are gone. */
      operable?: { configFiles: string[] }
    }>,
  ): Promise<void> {
    try {
      // A database that was down during process startup is not abandoned. The
      // next Docker snapshot retries migrations under their write lock, then
      // records identity once persistence has recovered.
      if (!this.state.available) await this.initialize()
      await Promise.all(
        environments.map((environment) =>
          this.environments.upsertSeen({
            composeProject: environment.name,
            workingDir: environment.workingDir,
            configFiles: environment.operable?.configFiles ?? [],
            repoUrl: environment.repoUrl,
            repoSubpath: environment.gitRoot,
          }),
        ),
      )
      this.markAvailable(this.state.migrations)
    } catch (error) {
      this.markUnavailable(error)
    }
  }

  status(): DatabaseStatus {
    return { ...this.state, migrations: [...this.state.migrations] }
  }

  private markAvailable(migrations: string[]): void {
    this.state = {
      configured: true,
      available: true,
      reason: null,
      checkedAt: Math.floor(Date.now() / 1000),
      migrations,
    }
  }

  private markUnavailable(error: unknown): void {
    this.state = {
      ...this.state,
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      checkedAt: Math.floor(Date.now() / 1000),
    }
  }

  close(): Promise<void> {
    return this.backend.close()
  }
}

/**
 * The database is a boot requirement, so a missing one is not a state the
 * panel can be in. This turns a *transiently unreachable* one into a 503,
 * which is still worth distinguishing from a bug.
 */
export function requireDatabase(database: Database): Database {
  if (!database.status().available) throw new DatabaseUnavailable()
  return database
}

export type { ProjectRecord } from './projects.ts'
export type { NewSshKeyRecord, SshKeyRecord } from './ssh-keys.ts'
export { SshKeysRepository } from './ssh-keys.ts'
