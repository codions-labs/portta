// What each project keeps on the Docker disk, read from the engine on the host.
//
// `docker system df -v` walks every volume, which on a busy server takes seconds, so
// it runs on its own slow clock: the collector asks every few seconds and gets the last
// answer, and a refresh starts in the background once that answer is old.

import { type DockerStorage, parseDockerStorage } from 'portta-core'
import { runProcess } from '../process.js'

const TIMEOUT_MS = 120_000
const REFRESH_MS = 5 * 60_000

let last: DockerStorage | null = null
let askedAt = 0
let running = false

async function read(now: number): Promise<void> {
  running = true
  try {
    const result = await runProcess('docker', ['system', 'df', '-v', '--format', '{{json .}}'], {
      reject: false,
      timeout: TIMEOUT_MS,
    })
    if (!result.failed) last = parseDockerStorage(result.stdout, Math.floor(now / 1000)) ?? last
  } finally {
    running = false
  }
}

export function readDockerStorage(now = Date.now()): DockerStorage | null {
  if (!running && now - askedAt >= REFRESH_MS) {
    askedAt = now
    void read(now)
  }
  return last
}
