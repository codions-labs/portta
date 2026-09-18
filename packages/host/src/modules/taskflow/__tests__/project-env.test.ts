import { afterEach, describe, expect, it } from 'vitest'
import { leakedProjectEnvKeys, stripProjectEnv } from '../adapters/project-env.ts'

const original = process.env.PORTTA_FLOW_PROJECT_ENV_KEYS

afterEach(() => {
  if (original === undefined) delete process.env.PORTTA_FLOW_PROJECT_ENV_KEYS
  else process.env.PORTTA_FLOW_PROJECT_ENV_KEYS = original
})

describe('leakedProjectEnvKeys', () => {
  it('returns an empty set when no project env keys were loaded', () => {
    delete process.env.PORTTA_FLOW_PROJECT_ENV_KEYS
    expect(leakedProjectEnvKeys().size).toBe(0)
  })

  it('includes the listed keys plus the marker var itself, trimming blanks', () => {
    process.env.PORTTA_FLOW_PROJECT_ENV_KEYS = 'SUPABASE_URL, SUPABASE_ANON_KEY ,'
    expect(leakedProjectEnvKeys()).toEqual(
      new Set(['PORTTA_FLOW_PROJECT_ENV_KEYS', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']),
    )
  })
})

describe('stripProjectEnv', () => {
  it("removes the launch project's keys and the marker, keeping unrelated vars", () => {
    process.env.PORTTA_FLOW_PROJECT_ENV_KEYS = 'SUPABASE_URL'
    const result = stripProjectEnv({
      SUPABASE_URL: 'secret',
      PORTTA_FLOW_PROJECT_ENV_KEYS: 'SUPABASE_URL',
      PATH: '/usr/bin',
      HOME: '/root',
      UNSET: undefined,
    })
    expect(result).toEqual({ PATH: '/usr/bin', HOME: '/root' })
  })

  it('returns a full copy of defined vars when there is nothing to strip', () => {
    delete process.env.PORTTA_FLOW_PROJECT_ENV_KEYS
    expect(stripProjectEnv({ A: '1', B: '2', C: undefined })).toEqual({ A: '1', B: '2' })
  })
})
