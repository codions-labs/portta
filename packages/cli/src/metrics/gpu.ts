// What the GPU's memory is used for, read on the host with nvidia-smi.
//
// Only NVIDIA's tool names processes, and only on Linux can a process be traced to its
// container, so on any other host this reads nothing and the project has no GPU figure.
// The program is asked every few seconds at most: it talks to the driver.

import { readFileSync } from 'node:fs'
import { containerIdFromCgroup, type GpuMemory, parseGpuMemory, parseGpuProcesses } from 'portta-core'
import { runProcess } from '../process.js'

const TIMEOUT_MS = 10_000
const CACHE_MS = 15_000

export interface GpuReading {
  memory: GpuMemory | null
  /** Bytes of GPU memory by container id. */
  byContainer: Map<string, number>
}

let cached: { at: number; reading: GpuReading | null } | null = null

async function smi(args: string[]): Promise<string | null> {
  const result = await runProcess('nvidia-smi', args, { reject: false, timeout: TIMEOUT_MS })
  return result.failed ? null : result.stdout
}

function containerOf(pid: number): string | null {
  try {
    return containerIdFromCgroup(readFileSync(`/proc/${pid}/cgroup`, 'utf8'))
  } catch {
    // The process ended since nvidia-smi listed it.
    return null
  }
}

export async function readGpu(now = Date.now()): Promise<GpuReading | null> {
  if (process.platform !== 'linux') return null
  if (cached && now - cached.at < CACHE_MS) return cached.reading
  const [apps, memory] = await Promise.all([
    smi(['--query-compute-apps=pid,used_gpu_memory', '--format=csv,noheader,nounits']),
    smi(['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits']),
  ])
  let reading: GpuReading | null = null
  if (memory !== null) {
    const byContainer = new Map<string, number>()
    for (const entry of parseGpuProcesses(apps ?? '')) {
      const id = containerOf(entry.pid)
      if (id) byContainer.set(id, (byContainer.get(id) ?? 0) + entry.memoryBytes)
    }
    reading = { memory: parseGpuMemory(memory), byContainer }
  }
  cached = { at: now, reading }
  return reading
}
