// What the database refuses.
//
// Every rule here is also enforced in the panel, and that is the point: a limit
// that lives in one process is not a limit. These tests pin the second copy —
// the one that still holds when a migration, a `portta db shell` session or a
// future service writes a row.
//
// SQLite makes this worth care. `text(…, { enum })` is a TypeScript union and
// nothing else in the generated DDL, so the vocabularies are only real because
// `vocabularyCheck` puts them there — and these tests are what proves it, for
// every vocabulary the panel writes.

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { projectMembers } from '../src/schema/access.ts'
import { apiKeys, sessions, users } from '../src/schema/auth.ts'
import { environmentIssues, environments, projectEnvironments } from '../src/schema/environments.ts'
import { projects, repositories } from '../src/schema/projects.ts'
import { activityEvents, workSessions } from '../src/schema/work.ts'
import { createTestDb, resetTestDb, type TestDatabase } from '../src/test-db.ts'

/**
 * Drizzle wraps a driver error in one that repeats the statement, so the
 * constraint's name — the thing worth asserting — is in `cause`. This walks the
 * chain and returns everything it said, so a test can name the constraint it
 * expects rather than the query it sent.
 */
function refusalFor(work: () => unknown): string {
  try {
    work()
  } catch (error) {
    const parts: string[] = []
    let current: unknown = error
    while (current instanceof Error) {
      parts.push(current.message)
      current = (current as { cause?: unknown }).cause
    }
    return parts.join(' | ')
  }
  throw new Error('the database accepted a row it should have refused')
}

// One database for the file, emptied before every test: the constraints are
// the schema's, and the rows are each test's own.
let open: TestDatabase
const db = () => open.db

beforeAll(async () => {
  open = await createTestDb()
})

beforeEach(async () => {
  await resetTestDb(open.db)
})

afterAll(async () => {
  await open.close()
})

function aUser(id: string, email: string): string {
  db().insert(users).values({ id, name: id, email }).run()
  return id
}

function aProject(slug: string): number {
  const [row] = db().insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).all()
  return row!.id
}

function anEnvironment(composeProject: string): number {
  const [row] = db().insert(environments).values({ composeProject }).returning({ id: environments.id }).all()
  return row!.id
}

describe('the vocabularies the database owns', () => {
  // Without vocabularyCheck these would all pass silently: SQLite stores any
  // text in a text column, and the union only exists at compile time.
  it('refuses a value nothing in portta-core names, for every vocabulary the panel writes', () => {
    const projectId = aProject('alpha')
    const environmentId = anEnvironment('one')
    db().insert(repositories).values({ projectId, name: 'api' }).run()
    const cases: Array<[string, string]> = [
      ["INSERT INTO users (id, name, email, role) VALUES ('u', 'u', 'u@x', 'superuser')", 'users_role_check'],
      [`UPDATE projects SET task_provider = 'jira' WHERE id = ${projectId}`, 'projects_task_provider_check'],
      [`UPDATE repositories SET provider = 'sourcehut' WHERE project_id = ${projectId}`, 'repositories_provider_check'],
      [
        `INSERT INTO project_environments (project_id, environment_id, source) VALUES (${projectId}, ${environmentId}, 'vibes')`,
        'project_environments_source_check',
      ],
      [
        `INSERT INTO environment_issues (environment_id, issue_ref, source) VALUES (${environmentId}, 'github:a/b#1', 'telepathy')`,
        'environment_issues_source_check',
      ],
      [
        `INSERT INTO work_sessions (project_id, actor, actor_kind) VALUES (${projectId}, 'a', 'robot')`,
        'work_sessions_actor_kind_check',
      ],
      [
        `INSERT INTO work_sessions (project_id, actor, actor_kind, status) VALUES (${projectId}, 'a', 'human', 'paused')`,
        'work_sessions_status_check',
      ],
      [
        `INSERT INTO activity_events (kind, summary, source) VALUES ('k', 's', 'telegram')`,
        'activity_events_source_check',
      ],
      [
        `INSERT INTO audit_log (principal_kind, actor, action, resource_type) VALUES ('daemon', 'a', 'x.y', 'r')`,
        'audit_log_principal_kind_check',
      ],
    ]
    for (const [statement, constraint] of cases) {
      expect(
        refusalFor(() => db().run(sql.raw(statement))),
        statement,
      ).toContain(constraint)
    }
  })

  it('accepts every role portta-core names', () => {
    for (const role of ['owner', 'admin', 'developer', 'viewer'] as const) {
      db()
        .insert(users)
        .values({ id: role, name: role, email: `${role}@x`, role })
        .run()
    }
    expect(db().select().from(users).all()).toHaveLength(4)
  })

  it('accepts both providers work can live in, and no third', () => {
    const projectId = aProject('alpha')
    for (const provider of ['github', 'linear'] as const) {
      db().update(projects).set({ taskProvider: provider }).where(eq(projects.id, projectId)).run()
    }
    // Null is not a third mode: it means "not chosen", and the panel derives it.
    db().update(projects).set({ taskProvider: null }).where(eq(projects.id, projectId)).run()
    expect(db().select().from(projects).all()[0]?.taskProvider).toBeNull()
  })
})

describe('the checks the database keeps', () => {
  it('refuses a project path that walks up out of Projects Home', () => {
    const refusal = refusalFor(() =>
      db().insert(projects).values({ slug: 'a', name: 'A', relativePath: '../escape' }).run(),
    )
    expect(refusal).toMatch(/projects_relative_path_check/)
  })

  it('refuses a name that is only whitespace', () => {
    expect(refusalFor(() => db().insert(projects).values({ slug: 'a', name: '   ' }).run())).toMatch(
      /projects_name_check/,
    )
    expect(refusalFor(() => db().insert(environments).values({ composeProject: '  ' }).run())).toMatch(
      /environments_compose_project_check/,
    )
  })

  // A ref with no provider addresses nothing, and the whole point of storing a
  // ref rather than an id is that it says where to look.
  it('refuses an issue ref with no provider', () => {
    const environmentId = anEnvironment('one')
    const refusal = refusalFor(() =>
      db().insert(environmentIssues).values({ environmentId, issueRef: '113', source: 'manual' }).run(),
    )
    expect(refusal).toMatch(/environment_issues_ref_check/)
  })

  it('refuses a second instance row', () => {
    db().run(sql`INSERT INTO instance (id, name) VALUES ('a', 'first')`)
    const refusal = refusalFor(() => db().run(sql`INSERT INTO instance (id, name) VALUES ('b', 'second')`))
    expect(refusal).toMatch(/instance_singleton_unique|UNIQUE constraint/i)
  })
})

describe('what a removal takes with it', () => {
  it('takes a user’s sessions, tokens and memberships', () => {
    const userId = aUser('u1', 'u1@example.test')
    const projectId = aProject('alpha')
    db()
      .insert(sessions)
      .values({ token: 't', userId, expiresAt: new Date(Date.now() + 60_000) })
      .run()
    db().insert(apiKeys).values({ key: 'hash', referenceId: userId }).run()
    db().insert(projectMembers).values({ projectId, userId }).run()

    db().delete(users).where(eq(users.id, userId)).run()

    expect(db().select().from(sessions).all()).toHaveLength(0)
    expect(db().select().from(apiKeys).all()).toHaveLength(0)
    expect(db().select().from(projectMembers).all()).toHaveLength(0)
  })

  // The attribution survives the person: `actor` keeps the name, so a session
  // does not become anonymous when somebody leaves.
  it('leaves a work session standing when the user who opened it is removed', () => {
    const userId = aUser('u2', 'u2@example.test')
    const projectId = aProject('alpha')
    db().insert(workSessions).values({ projectId, actor: 'u2', actorKind: 'human', userId }).run()

    db().delete(users).where(eq(users.id, userId)).run()

    const [row] = db().select().from(workSessions).all()
    expect(row?.actor).toBe('u2')
    expect(row?.userId).toBeNull()
  })

  it('takes a project’s sessions, activity and memberships', () => {
    const userId = aUser('u3', 'u3@example.test')
    const projectId = aProject('alpha')
    db().insert(workSessions).values({ projectId, actor: 'a', actorKind: 'human' }).run()
    db().insert(activityEvents).values({ kind: 'issue.linked', summary: 's', projectId }).run()
    db().insert(projectMembers).values({ projectId, userId }).run()

    db().delete(projects).where(eq(projects.id, projectId)).run()

    expect(db().select().from(workSessions).all()).toHaveLength(0)
    expect(db().select().from(activityEvents).all()).toHaveLength(0)
    expect(db().select().from(projectMembers).all()).toHaveLength(0)
  })

  it('forgets the issue link when the environment is forgotten', () => {
    const environmentId = anEnvironment('one')
    db().insert(environmentIssues).values({ environmentId, issueRef: 'github:a/b#1', source: 'manual' }).run()

    db().delete(environments).where(eq(environments.id, environmentId)).run()

    expect(db().select().from(environmentIssues).all()).toHaveLength(0)
  })
})

describe('an environment runs for at most one issue', () => {
  it('gives an issue many environments and an environment one issue', () => {
    const first = anEnvironment('one')
    const second = anEnvironment('two')

    // One issue, two environments: normal.
    db()
      .insert(environmentIssues)
      .values([
        { environmentId: first, issueRef: 'github:a/b#1', source: 'manual' },
        { environmentId: second, issueRef: 'github:a/b#1', source: 'branch' },
      ])
      .run()

    // Two issues, one environment: "what is this running for" would have two
    // answers, so the primary key refuses it.
    const refusal = refusalFor(() =>
      db().insert(environmentIssues).values({ environmentId: first, issueRef: 'github:a/b#2', source: 'manual' }).run(),
    )
    expect(refusal).toMatch(/UNIQUE constraint|PRIMARY KEY/i)
  })
})

describe('an environment belongs to at most one project', () => {
  it('refuses a second project claiming it', () => {
    const first = aProject('alpha')
    const second = aProject('beta')
    const environmentId = anEnvironment('shared')

    db().insert(projectEnvironments).values({ projectId: first, environmentId, source: 'manual' }).run()
    const refusal = refusalFor(() =>
      db().insert(projectEnvironments).values({ projectId: second, environmentId, source: 'manual' }).run(),
    )
    expect(refusal).toMatch(/project_environments_one_project_per_env|UNIQUE constraint/i)
  })
})

describe('one project, one name per repository', () => {
  it('refuses a duplicate repository name inside a project', () => {
    const projectId = aProject('alpha')
    db().insert(repositories).values({ projectId, name: 'api' }).run()
    const refusal = refusalFor(() => db().insert(repositories).values({ projectId, name: 'api' }).run())
    expect(refusal).toMatch(/repositories_project_id_name_key|UNIQUE constraint/i)
  })
})
