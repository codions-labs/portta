import { describe, expect, it } from 'vitest'
import { initOptionsFromCli, resolveInitAnalysis } from './init.ts'
import { parseFlowAction } from './test-support.ts'

async function parseInit(args: string[]) {
  return initOptionsFromCli((await parseFlowAction(['init', ...args])).options)
}

describe('init analysis selection', () => {
  it('uses the default harness only for an unresolved automatic runtime', async () => {
    expect(resolveInitAnalysis(await parseInit(['--analyze=auto']), 'host')).toBe('claude')
    expect(resolveInitAnalysis(await parseInit(['--analyze=auto']), 'compose')).toBeNull()
    expect(resolveInitAnalysis(await parseInit(['--analyze=auto', '--runtime=host']), 'host')).toBeNull()
  })

  it('keeps explicit agent selection and validates analyze values', async () => {
    expect(resolveInitAnalysis(await parseInit(['--analyze=codex']), 'compose')).toBe('codex')
    expect(await parseInit(['--analyze'])).toEqual({ analyze: 'claude', runtime: 'auto' })
    await expect(parseInit(['--analyze=unknown'])).rejects.toThrow('Allowed choices are auto, claude, codex')
  })

  it('accepts one runtime override, as a flag or a shortcut', async () => {
    expect(await parseInit(['--compose'])).toEqual({ analyze: null, runtime: 'compose' })
    expect(await parseInit(['--runtime', 'dockerfile'])).toEqual({ analyze: null, runtime: 'dockerfile' })
    await expect(parseInit(['--host', '--compose'])).rejects.toThrow('Choose only one runtime override')
    await expect(parseInit(['--runtime=host', '--compose'])).rejects.toThrow('Choose only one runtime override')
  })
})
