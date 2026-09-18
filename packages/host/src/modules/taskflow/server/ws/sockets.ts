import type { WebSocket } from 'ws'

interface TrackedSocket {
  socket: WebSocket
  cleanup: () => void
}

/** The open WebSockets of every Project. A Project with at least one is being
 *  viewed (`active`), and removing a Project closes its sockets after running
 *  their cleanup. */
export class ProjectSockets {
  private readonly byProject = new Map<string, Set<TrackedSocket>>()
  private readonly setActive: (prefix: string, active: boolean) => void

  constructor(setActive: (prefix: string, active: boolean) => void) {
    this.setActive = setActive
  }

  track(prefix: string, socket: WebSocket, cleanup: () => void | Promise<void>): void {
    let done = false
    const tracked: TrackedSocket = {
      socket,
      // Runs once, whichever comes first: the socket closing or its Project going away.
      cleanup: (): void => {
        if (done) return
        done = true
        void cleanup()
      },
    }
    let sockets = this.byProject.get(prefix)
    if (!sockets) {
      sockets = new Set()
      this.byProject.set(prefix, sockets)
    }
    sockets.add(tracked)
    // First socket for this project → it's being viewed.
    if (sockets.size === 1) this.setActive(prefix, true)
    socket.once('close', (): void => {
      tracked.cleanup()
      this.untrack(prefix, tracked)
    })
  }

  /** Run each socket's cleanup (tmux detach, agents unsubscribe), then close it. */
  closeProject(prefix: string): void {
    const sockets = this.byProject.get(prefix)
    if (!sockets) return
    this.byProject.delete(prefix)
    for (const tracked of sockets) {
      tracked.cleanup()
      try {
        tracked.socket.close(1001, 'project removed')
      } catch {
        // already closing — cleanup above already ran
      }
    }
  }

  /** Close every socket, for shutdown. */
  closeAll(): void {
    for (const prefix of [...this.byProject.keys()]) this.closeProject(prefix)
  }

  private untrack(prefix: string, tracked: TrackedSocket): void {
    const sockets = this.byProject.get(prefix)
    if (!sockets?.delete(tracked) || sockets.size > 0) return
    this.byProject.delete(prefix)
    this.setActive(prefix, false)
  }
}
