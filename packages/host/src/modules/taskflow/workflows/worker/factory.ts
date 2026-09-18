import { BUILTIN_PROVIDER_IDS, isBuiltinProvider, type ProviderId } from '../dsl/types.ts'
import { ClaudeWorker } from './claude.ts'
import { CodexWorker } from './codex.ts'
import { FakeWorker } from './fake.ts'
import { AgentError, type Worker, type WorkerFactory } from './index.ts'
import { OpencodeWorker } from './opencode.ts'
import { PiWorker } from './pi.ts'

export interface FactoryOpts {
  /** Use the in-process FakeWorker for every provider (smoke tests, --fake). */
  fake?: boolean
  codexBin?: string
  claudeModel?: string
  /** Path to the claude-code executable (forwarded to the SDK). */
  pathToClaudeCodeExecutable?: string
  opencodeBin?: string
  piBin?: string
}

export class DefaultWorkerFactory implements WorkerFactory {
  private readonly cache = new Map<ProviderId, Worker>()
  private readonly opts: FactoryOpts
  constructor(opts: FactoryOpts = {}) {
    this.opts = opts
  }

  get(id: ProviderId): Worker {
    let w = this.cache.get(id)
    if (!w) {
      w = this.create(id)
      this.cache.set(id, w)
    }
    return w
  }

  private create(id: ProviderId): Worker {
    if (this.opts.fake) return new FakeWorker()
    // ProviderId is open (the ACP registry may declare more ids); this factory only runs the
    // builtins in-process, so anything else fails here instead of silently routing to a billed
    // provider.
    if (!isBuiltinProvider(id)) {
      throw new AgentError({
        provider: id,
        code: 'unknown_provider',
        message: `unknown provider: ${id} — the workflow engine runs ${BUILTIN_PROVIDER_IDS.join(', ')}; a provider declared in taskflow.yaml needs the ACP transport`,
      })
    }
    switch (id) {
      case 'codex':
        return new CodexWorker({ bin: this.opts.codexBin })
      case 'claude-code':
        return new ClaudeWorker({
          model: this.opts.claudeModel,
          pathToClaudeCodeExecutable: this.opts.pathToClaudeCodeExecutable,
        })
      case 'opencode':
        return new OpencodeWorker({ bin: this.opts.opencodeBin })
      case 'pi':
        return new PiWorker({ bin: this.opts.piBin })
      default: {
        // Exhaustive: a new BuiltinProviderId must be handled here.
        const unknown: never = id
        throw new AgentError({
          provider: id,
          code: 'unknown_provider',
          message: `unknown provider: ${String(unknown)}`,
        })
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const w of this.cache.values()) {
      try {
        await w.shutdown()
      } catch {
        // best-effort
      }
    }
    this.cache.clear()
  }
}
