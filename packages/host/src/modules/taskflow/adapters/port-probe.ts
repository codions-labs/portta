export interface PortProbe {
  isListening(port: number): Promise<boolean>
}

export class NodePortProbe implements PortProbe {
  private readonly timeoutMs: number
  private readonly hostnames: readonly string[]
  constructor(timeoutMs = 300, hostnames: readonly string[] = ['127.0.0.1', '::1']) {
    this.timeoutMs = timeoutMs
    this.hostnames = hostnames
  }

  isListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      let pending = this.hostnames.length

      const settle = (result: boolean): void => {
        if (settled) return
        if (result) {
          settled = true
          clearTimeout(timer)
          resolve(true)
          return
        }
        pending--
        if (pending === 0) {
          settled = true
          clearTimeout(timer)
          resolve(false)
        }
      }

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          resolve(false)
        }
      }, this.timeoutMs)

      for (const hostname of this.hostnames) {
        const socket = new Socket()
        socket.setTimeout(this.timeoutMs, (): void => {
          socket.destroy()
          settle(false)
        })
        socket.once('connect', (): void => {
          socket.end()
          settle(true)
        })
        socket.once('error', (): void => settle(false))
        socket.connect(port, hostname)
      }
    })
  }
}

import { Socket } from 'node:net'
