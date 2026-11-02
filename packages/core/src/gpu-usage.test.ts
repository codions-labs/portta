import { describe, expect, it } from 'vitest'
import { containerIdFromCgroup, parseGpuMemory, parseGpuProcesses } from './gpu-usage.ts'

const ID = 'a'.repeat(64)

describe('GPU processes', () => {
  it('reads pid and memory in MiB, and skips what is not a number', () => {
    expect(parseGpuProcesses('1234, 2048\n55, [N/A]\n\n77, 0\nx, 5')).toEqual([
      { pid: 1234, memoryBytes: 2048 * 1024 * 1024 },
      { pid: 77, memoryBytes: 0 },
    ])
  })
  it('adds the memory of every device', () => {
    expect(parseGpuMemory('1000, 8000\n500, 8000')).toEqual({
      usedBytes: 1500 * 1024 * 1024,
      totalBytes: 16000 * 1024 * 1024,
    })
    expect(parseGpuMemory('')).toBeNull()
    expect(parseGpuMemory('[N/A], [N/A]')).toBeNull()
  })
})

describe('the container of a process', () => {
  it('reads it from a systemd or a cgroup v1 path', () => {
    expect(containerIdFromCgroup(`0::/system.slice/docker-${ID}.scope\n`)).toBe(ID)
    expect(containerIdFromCgroup(`12:devices:/docker/${ID}\n`)).toBe(ID)
  })
  it('says none for a process on the host, or an id that is too short', () => {
    expect(containerIdFromCgroup('0::/user.slice/user-1000.slice/session-3.scope\n')).toBeNull()
    expect(containerIdFromCgroup('0::/docker/abc123\n')).toBeNull()
  })
})
