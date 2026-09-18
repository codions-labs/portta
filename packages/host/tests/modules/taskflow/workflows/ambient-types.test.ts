// Drift guard: the ambient declarations inline copies of the DSL option types (so the file stays
// self-contained); these assertions keep the inlined unions and keys in sync with dsl/types.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../src/modules/taskflow/workflows')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('ambient inlined types stay in sync with dsl/types.ts (M31 drift guard)', () => {
  const types = read('dsl/types.ts')
  const ambient = read('dsl/ambient.d.ts')

  const unionMembers = (src: string, name: string) => {
    const m = src.match(new RegExp(`(?:export )?type ${name}\\s*=\\s*([^\\n]+)`))
    assert.ok(m, `union ${name} not found`)
    const members = m[1]
    assert.ok(members, `union ${name} has no members`)
    // Sources use single quotes; accept both so the comparison never degrades to [] vs [].
    const quoted = [...members.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).sort()
    assert.ok(quoted.length > 0, `union ${name} has no quoted members`)
    return quoted
  }

  // The ambient union lists the builtins (from the BUILTIN_PROVIDER_IDS tuple, not a literal union)
  // plus a `(string & {})` widening for ids declared in the ACP registry; only the quoted members
  // are compared.
  test('TaskflowProviderId lists the BUILTIN_PROVIDER_IDS', () => {
    const m = types.match(/const BUILTIN_PROVIDER_IDS\s*=\s*\[([^\]]+)\]/)
    assert.ok(m, 'BUILTIN_PROVIDER_IDS tuple not found in dsl/types.ts')
    const tupleSource = m[1]
    assert.ok(tupleSource, 'BUILTIN_PROVIDER_IDS tuple has no members')
    const tuple = [...tupleSource.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).sort()
    assert.ok(tuple.length > 0, 'BUILTIN_PROVIDER_IDS tuple has no quoted members')
    assert.deepEqual(unionMembers(ambient, 'TaskflowProviderId'), tuple)
    assert.match(ambient, /type TaskflowProviderId = [^\n]*\(string & \{\}\)/, 'ambient provider widening missing')
  })

  for (const [canonical, inlined] of [
    ['Sandbox', 'TaskflowSandbox'],
    ['Effort', 'TaskflowEffort'],
    ['Approval', 'TaskflowApproval'],
  ] as const) {
    test(`${inlined} matches ${canonical}`, () => {
      assert.deepEqual(unionMembers(ambient, inlined), unionMembers(types, canonical))
    })
  }

  test('TaskflowAgentOpts carries the same keys as AgentOpts', () => {
    const interfaceKeys = (src: string, name: string) => {
      const start = src.indexOf(`interface ${name} {`)
      assert.ok(start >= 0, `interface ${name} not found`)
      let depth = 0
      let end = start
      for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}' && --depth === 0) {
          end = i
          break
        }
      }
      const body = src.slice(start, end)
      return [...body.matchAll(/^\s+(\w+)\?:/gm)].map((x) => x[1]).sort()
    }
    assert.deepEqual(interfaceKeys(ambient, 'TaskflowAgentBaseOpts'), interfaceKeys(types, 'AgentOptsBase'))
    // The provider/model pair rides a both-or-neither union on top of the base opts in BOTH files
    // (see ProviderModelPair) — the base interfaces must not re-grow either key field-wise.
    assert.ok(/type TaskflowAgentOpts = TaskflowAgentBaseOpts &/.test(ambient), 'ambient pair union missing')
    assert.ok(/\{ provider\?: never; model\?: never \}/.test(ambient), 'ambient both-or-neither arm missing')
    assert.ok(/type AgentOpts = AgentOptsBase & ProviderModelPair/.test(types), 'types.ts pair union missing')
  })
})
