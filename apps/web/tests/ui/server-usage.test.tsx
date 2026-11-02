import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from './render.tsx'

const GB = 1024 ** 3
const metricsCurrent = vi.fn()
vi.mock('@/lib/api', () => ({
  api: {
    metricsCurrent: () => metricsCurrent(),
    metricsHistory: () => Promise.resolve({ version: 1, window: '30m', points: [] }),
    host: () => Promise.resolve({ engine: null }),
    environmentReport: () => Promise.resolve({ collectedAt: null, checks: [], summary: { problems: 0 } }),
    hostSecurityReport: () => Promise.resolve({ collectedAt: null, checks: [] }),
  },
}))

const { HostHealthView } = await import('../../app/(panel)/host/health-view.tsx')

function project(composeProject: string, memory: number, cpu: number, own?: true) {
  return {
    id: composeProject,
    name: composeProject,
    composeProject,
    own,
    memoryUsedBytes: memory,
    cpuUtilisation: cpu,
    containerCount: 1,
    networkRxBytes: null,
    networkTxBytes: null,
    containers: [],
  }
}

beforeEach(() =>
  metricsCurrent.mockReset().mockResolvedValue({
    version: 1,
    instance: { id: 'i', name: null, hostname: 'vps-01' },
    collectedAt: Math.floor(Date.now() / 1000),
    ageSeconds: 1,
    stale: false,
    collectorActive: true,
    runtime: { name: 'docker-engine' },
    dockerStorage: {
      collectedAt: 1,
      projects: [
        { composeProject: 'shop', volumeBytes: 30e9, layerBytes: 2e9 },
        { composeProject: 'portta', volumeBytes: 4e9, layerBytes: 0 },
      ],
    },
    projects: [
      { ...project('shop', 3 * GB, 0.3), gpuMemoryBytes: 6 * GB },
      project('blog', 1 * GB, 0.1),
      project('portta', 0.5 * GB, 0.05, true),
    ],
    host: {
      hostname: 'vps-01',
      manufacturer: null,
      model: null,
      productName: null,
      kind: null,
      architecture: 'x86_64',
      virtual: true,
      platform: 'linux',
      distro: 'Debian GNU/Linux',
      version: '13',
      release: 'trixie',
      kernel: '6.12.43-amd64',
      uptimeSeconds: 6 * 86400,
      timezone: 'America/Sao_Paulo',
      utcOffsetMinutes: -180,
      cpu: {
        manufacturer: 'AMD',
        brand: 'AMD EPYC 7763',
        physicalCores: 4,
        logicalCores: 4,
        speed: 2.4,
        speedMax: null,
      },
      memoryTotalBytes: 32 * GB,
      memoryUsedBytes: 12 * GB,
      memoryAvailableBytes: 20 * GB,
      memoryUsedPercent: 0.375,
      swapTotalBytes: null,
      swapUsedBytes: null,
      cpuUtilisation: 0.2,
      cpuIdle: 0.8,
      load: { one: 0.4, five: 0.3, fifteen: 0.2 },
      storage: {
        path: '/opt/portta',
        mount: '/',
        filesystem: 'ext4',
        totalBytes: 512e9,
        usedBytes: 208e9,
        availableBytes: 304e9,
        usedPercent: 0.41,
      },
      gpu: [],
      gpuMemory: { usedBytes: 10 * GB, totalBytes: 24 * GB },
      temperatureCelsius: null,
      battery: null,
    },
  }),
)

describe('the server page', () => {
  it('reads memory, CPU and disk as the whole server, in percent', async () => {
    renderWithQuery(<HostHealthView />, 'en')
    const memory = await screen.findByRole('group', { name: 'Server memory' })
    expect(within(memory).getByText('38%')).toBeInTheDocument()
    expect(within(memory).getByText(/12 GB of 32 GB/)).toBeInTheDocument()
    const disk = screen.getByRole('group', { name: 'Server disk' })
    expect(within(disk).getByText('41%')).toBeInTheDocument()
    expect(within(disk).getByText(/208 GB of 512 GB/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Server CPU' })).toHaveTextContent('20%')
  })

  it('says how much of what is in use belongs to the projects', async () => {
    renderWithQuery(<HostHealthView />, 'en')
    expect(await screen.findByText('Projects use 33% of the memory in use.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /shop/ })).toHaveAttribute('href', '/environments/shop')
    // Portta's own containers are not a project among the others.
    expect(screen.queryByRole('link', { name: /portta/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'CPU' }))
    expect(await screen.findByText('Projects use 50% of the CPU in use.')).toBeInTheDocument()
  })

  it('splits the disk by project once the collector reports what each keeps', async () => {
    renderWithQuery(<HostHealthView />, 'en')
    await userEvent.click(await screen.findByRole('button', { name: 'Disk' }))
    expect(await screen.findByText('Projects use 15% of the disk in use.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /shop/ })).toHaveAttribute('href', '/environments/shop')
  })

  it('splits the GPU memory when the server has one', async () => {
    renderWithQuery(<HostHealthView />, 'en')
    expect(await screen.findByRole('group', { name: 'Server GPU memory' })).toHaveTextContent('42%')
    await userEvent.click(screen.getByRole('button', { name: 'GPU' }))
    expect(await screen.findByText('Projects hold 60% of the GPU memory in use.')).toBeInTheDocument()
  })

  it('shows the disk whole when the collector has not reported it', async () => {
    const current = await metricsCurrent()
    metricsCurrent.mockResolvedValue({ ...current, dockerStorage: null })
    renderWithQuery(<HostHealthView />, 'en')
    await userEvent.click(await screen.findByRole('button', { name: 'Disk' }))
    expect(await screen.findByText(/The disk is shown as a whole until/)).toBeInTheDocument()
  })

  it('names the time zone the server is set to', async () => {
    renderWithQuery(<HostHealthView />, 'pt-BR')
    expect(await screen.findAllByText(/America\/Sao_Paulo/)).not.toHaveLength(0)
    expect(screen.getByText('Fuso horário')).toBeInTheDocument()
    expect(screen.getByText('Memória do servidor')).toBeInTheDocument()
  })
})
