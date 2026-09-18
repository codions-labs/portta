// Only the fields the panel actually reads. The Docker Engine API returns much
// more; narrowing it here keeps the rest of the code honest about what exists.

export interface DockerPortBinding {
  HostIp?: string
  HostPort?: string
}

export interface DockerContainerListItem {
  Id: string
  Names: string[]
  Image: string
  ImageID: string
  Command: string
  Created: number
  State: string
  Status: string
  Labels: Record<string, string>
  Ports: { IP?: string; PrivatePort: number; PublicPort?: number; Type: string }[]
  NetworkSettings?: { Networks?: Record<string, { NetworkID?: string; Aliases?: string[] | null }> }
  Mounts?: DockerMount[]
}

export interface DockerMount {
  Type: string
  Name?: string
  Source: string
  Destination: string
  RW: boolean
}

export interface DockerContainerInspect {
  Id: string
  Name: string
  Created: string
  RestartCount: number
  State: {
    Status: string
    Running: boolean
    ExitCode: number
    StartedAt: string
    FinishedAt: string
    Health?: { Status: string; FailingStreak: number }
  }
  /** Only the restart policy is read: it tells an exited one-shot from a service that is down. */
  HostConfig?: { RestartPolicy?: { Name?: string } }
  Config: {
    Image: string
    Labels: Record<string, string>
    ExposedPorts?: Record<string, unknown>
    Tty: boolean
    /** Present on inspect. Read only from the on-demand connection route. */
    Env?: string[]
  }
  NetworkSettings: {
    Ports: Record<string, DockerPortBinding[] | null>
    Networks: Record<string, { NetworkID?: string; Aliases?: string[] | null; IPAddress?: string }>
  }
  Mounts: DockerMount[]
}

export interface DockerNetwork {
  Id: string
  Name: string
  Driver: string
  Scope: string
  Internal: boolean
  Labels: Record<string, string> | null
  Containers?: Record<string, { Name: string }> | null
}

export interface DockerInfo {
  Name: string
  Containers: number
  ContainersRunning: number
  ContainersPaused: number
  ContainersStopped: number
  Images: number
  NCPU: number
  MemTotal: number
  OperatingSystem: string
  Architecture: string
  ServerVersion: string
  OSType?: string
  OSVersion?: string
  KernelVersion?: string
  DockerRootDir?: string
  Driver?: string
}

export interface DockerVersion {
  Version: string
  ApiVersion: string
  Os: string
  Arch: string
}

export interface DockerEvent {
  Type: string
  Action: string
  Actor?: { ID: string; Attributes?: Record<string, string> }
  time?: number
  timeNano?: number
}

export interface DockerStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number }
    system_cpu_usage?: number
    online_cpus?: number
  }
  precpu_stats?: {
    cpu_usage?: { total_usage?: number }
    system_cpu_usage?: number
  }
  memory_stats?: { usage?: number; limit?: number; stats?: Record<string, number> }
}
