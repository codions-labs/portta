// Who is using the GPU's memory, from `nvidia-smi` and the cgroup of each process.
//
// nvidia-smi names processes by their host PID, and a process in a container has a cgroup
// that names the container, so the memory of a GPU can be put on the project that runs it.
// Pure: the collector runs the program and reads /proc, and hands the text here.

export interface GpuProcess {
  pid: number
  memoryBytes: number
}

export interface GpuMemory {
  usedBytes: number
  totalBytes: number
}

const MIB = 1024 * 1024

/** `--query-compute-apps=pid,used_gpu_memory --format=csv,noheader,nounits`: one `pid, MiB` per line. */
export function parseGpuProcesses(csv: string): GpuProcess[] {
  const processes: GpuProcess[] = []
  for (const line of csv.split('\n')) {
    const [pid, memory] = line.split(',').map((part) => part.trim())
    const id = Number(pid)
    const mib = Number(memory)
    // A device that does not report per-process memory prints `[N/A]`, which is not a number.
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(mib) || mib < 0) continue
    processes.push({ pid: id, memoryBytes: Math.round(mib * MIB) })
  }
  return processes
}

/** `--query-gpu=memory.used,memory.total --format=csv,noheader,nounits`: one `MiB, MiB` per device, added up. */
export function parseGpuMemory(csv: string): GpuMemory | null {
  let usedBytes = 0
  let totalBytes = 0
  let devices = 0
  for (const line of csv.split('\n')) {
    const [used, total] = line.split(',').map((part) => Number(part.trim()))
    if (used === undefined || total === undefined || !Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
      continue
    }
    usedBytes += Math.round(used * MIB)
    totalBytes += Math.round(total * MIB)
    devices += 1
  }
  return devices === 0 ? null : { usedBytes, totalBytes }
}

const CONTAINER = /(?:^|\/)(?:docker-|docker\/|cri-containerd-)([0-9a-f]{64})(?:\.scope)?(?:\/|$)/m

/** The container a process runs in, from `/proc/<pid>/cgroup`; null for a process on the host itself. */
export function containerIdFromCgroup(text: string): string | null {
  return CONTAINER.exec(text)?.[1] ?? null
}
