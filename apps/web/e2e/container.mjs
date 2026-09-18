// Builders for the fake Docker Engine API used by the end-to-end run and by
// the documentation screenshots. Plain JavaScript on purpose: these run with
// nothing installed but Node.

const HOUR = 3600

/**
 * One container, in the two shapes the Docker API returns it: the list entry
 * and the inspect payload. Only the fields the panel reads are filled in.
 */
export function makeContainer({
  id,
  name,
  image,
  state = 'running',
  labels = {},
  networks = ['bridge'],
  exposed = [],
  published = [],
  health,
  mounts = [],
  upSeconds = 2 * HOUR,
  // A one-shot container is described by how it ended. Without these two, a
  // fixture cannot say "created and never started", which is exactly the state
  // a prepared applier is in.
  startedAt,
  exitCode = 0,
}) {
  const now = Math.floor(Date.now() / 1000)
  const started = now - upSeconds

  const ports = {}
  for (const port of exposed) ports[`${port}/tcp`] = null
  for (const binding of published) {
    ports[`${binding.containerPort}/tcp`] = [{ HostIp: binding.hostIp, HostPort: String(binding.hostPort) }]
  }
  const exposedPorts = {}
  for (const port of [...exposed, ...published.map((p) => p.containerPort)]) {
    exposedPorts[`${port}/tcp`] = {}
  }
  const networkMap = Object.fromEntries(networks.map((network) => [network, {}]))

  return {
    id,
    state,
    item: {
      Id: id,
      Names: [`/${name}`],
      Image: image,
      ImageID: `sha256:${id}`,
      Command: 'run',
      Created: started,
      State: state,
      Status: state === 'running' ? 'Up 2 hours' : 'Exited (0) 2 hours ago',
      Labels: labels,
      Ports: [],
      NetworkSettings: { Networks: networkMap },
      Mounts: mounts,
    },
    inspect: {
      Id: id,
      Name: `/${name}`,
      Created: new Date(started * 1000).toISOString(),
      RestartCount: 0,
      State: {
        Status: state,
        Running: state === 'running',
        ExitCode: exitCode,
        StartedAt: startedAt ?? new Date(started * 1000).toISOString(),
        FinishedAt: '0001-01-01T00:00:00Z',
        ...(health ? { Health: { Status: health, FailingStreak: 0 } } : {}),
      },
      Config: { Image: image, Labels: labels, ExposedPorts: exposedPorts, Tty: false },
      NetworkSettings: { Ports: ports, Networks: networkMap },
      Mounts: mounts,
    },
  }
}

/** A named volume, as Docker reports it on a container. */
export function volume(name, destination) {
  return {
    Type: 'volume',
    Name: name,
    Source: `/var/lib/docker/volumes/${name}/_data`,
    Destination: destination,
    RW: true,
  }
}

/** What `portta access open`, and the panel, create. */
export function makeBridge({ id, name, labels, targetPort, hostPort, network = 'demo-shop_default' }) {
  return makeContainer({
    id,
    name,
    image: 'alpine/socat:1.8.1.3',
    networks: [network],
    labels,
    published: [{ hostIp: '127.0.0.1', hostPort, containerPort: targetPort }],
    upSeconds: 240,
  })
}

/** The labels a gateway component carries. */
export function gatewayLabels(component) {
  return {
    'portta.managed': 'true',
    'portta.component': component,
    'traefik.enable': 'false',
  }
}

/** The labels Compose injects, plus the opt-in a routed service adds. */
export function composeLabels({ project, service, workingDir, routed = false, port, logicalProject }) {
  const labels = {
    'com.docker.compose.project': project,
    'com.docker.compose.service': service,
  }
  if (workingDir) labels['com.docker.compose.project.working_dir'] = workingDir
  if (logicalProject) labels['portta.project'] = logicalProject
  if (routed) {
    labels['traefik.enable'] = 'true'
    labels['traefik.docker.network'] = 'portta'
    if (port) {
      labels[`traefik.http.services.${project}-${service}.loadbalancer.server.port`] = String(port)
    }
  }
  return labels
}
