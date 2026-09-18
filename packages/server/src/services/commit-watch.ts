// What the repositories produced, noticed from the host scan.
//
// The scan writes HEAD and the last commits once a minute. This watcher reads
// each registered repository's file, compares HEAD with the last one it saw,
// and turns the difference into activity: a `repository.commit` event with the
// new commits, attributed to the sessions active on that repository, and a
// `repository.branch` event when the branch moved. Nothing here runs git.

import { collectTokens } from 'portta-auth-core'
import type { PanelConfig } from '../config.ts'
import type { Database } from '../db/index.ts'
import type { LiveHub } from '../realtime/hub.ts'
import { recordActivity } from './activity.ts'
import { collectAudit } from './audit.ts'
import { readRepositoryScan } from './git.ts'
import { loadScans, matchScan } from './repositories.ts'

interface Seen {
  head: string | null
  branch: string | null
}

export interface CommitWatch {
  /** One pass. Exposed so a test can drive it without a clock. */
  tick(): Promise<void>
  start(intervalMs?: number): void
  stop(): void
}

export function createCommitWatch(config: PanelConfig, db: Database, hub: LiveHub): CommitWatch {
  const seen = new Map<string, Seen>()
  let timer: NodeJS.Timeout | null = null
  let inFlight = false

  async function lastRecorded(repositoryId: string): Promise<Seen | null> {
    const events = await db.activity.list({ repositoryId, kinds: ['repository.commit', 'repository.branch'], limit: 5 })
    const commit = events.find((event) => event.kind === 'repository.commit')
    const branch = events.find((event) => event.kind === 'repository.branch')
    if (!commit && !branch) return null
    return {
      head: typeof commit?.data.head === 'string' ? (commit.data.head as string) : null,
      branch: typeof branch?.data.branch === 'string' ? (branch.data.branch as string) : null,
    }
  }

  async function tick(): Promise<void> {
    if (inFlight || !db.status().available) return
    inFlight = true
    try {
      const scans = loadScans(config)
      const repositories = await db.repositories.list()
      const sessions = await db.sessions.list({ status: ['active'], limit: 500 })
      for (const repository of repositories) {
        const match = matchScan(repository, scans.index)
        if (!match) continue
        const scan = readRepositoryScan(config, match.key)
        if (!scan.collected || !scan.git) continue
        const head = scan.git.head.sha || null
        const branch = scan.git.branch
        let previous = seen.get(repository.id)
        if (!previous) {
          previous = (await lastRecorded(repository.id)) ?? { head, branch }
          seen.set(repository.id, previous)
        }
        if (head && previous.head && head !== previous.head) {
          const fresh: { sha: string; subject: string; author: string; date: number }[] = []
          for (const commit of scan.commits) {
            if (commit.sha === previous.head) break
            fresh.push({ sha: commit.sha, subject: commit.subject, author: commit.author, date: commit.date })
          }
          const count = fresh.length > 0 ? fresh.length : 1
          await recordActivity(
            { db, hub },
            {
              kind: 'repository.commit',
              actorKind: 'system',
              projectId: repository.projectId,
              repositoryId: repository.id,
              summary: `${count} new commit${count === 1 ? '' : 's'} on ${repository.name}${fresh[0] ? `: ${fresh[0].subject}` : ''}`,
              data: { head, previous: previous.head, branch, commits: fresh },
            },
          )
          for (const session of sessions) {
            if (session.repositoryId !== repository.id) continue
            // A session can start after Git has moved but before this watcher
            // observes the new HEAD. Its captured HEAD is the strongest
            // boundary; commit time is only a fallback when that boundary has
            // fallen outside the bounded scan history.
            const boundary = session.headAfter ?? session.headBefore
            const boundaryIndex = boundary ? fresh.findIndex((commit) => commit.sha === boundary) : -1
            const startedAt = Math.floor(session.startedAt.getTime() / 1000)
            const sessionCommits =
              boundary === previous.head
                ? fresh
                : boundaryIndex >= 0
                  ? fresh.slice(0, boundaryIndex)
                  : fresh.filter((commit) => commit.date >= startedAt)
            if (sessionCommits.length === 0) continue
            const known = new Set(session.commits.map((commit) => commit.sha))
            const merged = [
              ...session.commits,
              ...sessionCommits
                .filter((commit) => !known.has(commit.sha))
                .map((commit) => ({ sha: commit.sha, subject: commit.subject, at: commit.date })),
            ]
            await db.sessions.recordCommits(session.id, sessionCommits[0]!.sha, merged)
          }
        }
        if (branch && previous.branch && branch !== previous.branch) {
          await recordActivity(
            { db, hub },
            {
              kind: 'repository.branch',
              actorKind: 'system',
              projectId: repository.projectId,
              repositoryId: repository.id,
              summary: `${repository.name} moved from ${previous.branch} to ${branch}`,
              data: { branch, previous: previous.branch },
            },
          )
        }
        seen.set(repository.id, { head, branch })
      }
    } catch (error) {
      process.stderr.write(`commit watch failed: ${error instanceof Error ? error.message : String(error)}\n`)
    } finally {
      inFlight = false
    }
  }

  return {
    tick,
    start(intervalMs = 60_000): void {
      if (timer !== null) return
      timer = setInterval(() => {
        void tick()
      }, intervalMs)
      timer.unref?.()
      void tick()
    },
    stop(): void {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}

/** Hourly housekeeping: stale sessions are closed, old activity, tokens and audit entries are pruned. */
export function createMaintenance(
  db: Database,
  hub: LiveHub,
): { tick(): Promise<void>; start(intervalMs?: number): void; stop(): void } {
  let timer: NodeJS.Timeout | null = null
  async function tick(): Promise<void> {
    if (!db.status().available) return
    try {
      for (const session of await db.sessions.abandonStale()) {
        await recordActivity(
          { db, hub },
          {
            kind: 'session.abandoned',
            actorKind: 'system',
            actor: session.actor,
            projectId: session.projectId,
            issueRef: session.issueRef,
            repositoryId: session.repositoryId,
            environmentId: session.environmentId,
            sessionId: session.id,
            summary: `${session.actor}'s session went quiet and was closed`,
          },
        )
      }
      await db.activity.prune()
      // Tokens that expired a month ago are switched off, and ones revoked a
      // quarter ago are dropped. Neither can end a token somebody is using:
      // both thresholds are long past the moment the token stopped working.
      await collectTokens(db.handle)
      // And audit entries past the retention window. The log answers "who did
      // that" about something noticed months later, not years later, and an
      // unbounded table on a development host is a table nobody prunes by hand.
      await collectAudit(db.handle)
    } catch (error) {
      process.stderr.write(`maintenance failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  return {
    tick,
    start(intervalMs = 60 * 60_000): void {
      if (timer !== null) return
      timer = setInterval(() => {
        void tick()
      }, intervalMs)
      timer.unref?.()
    },
    stop(): void {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}
