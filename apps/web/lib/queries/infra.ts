'use client'

import { useQuery } from '@tanstack/react-query'
import type { Overview } from 'portta-contracts'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useStatus(initialData?: Overview) {
  return useQuery({ queryKey: keys.status(), queryFn: api.overview, ...(initialData ? { initialData } : {}) })
}

export function useGateway(enabled = true) {
  return useQuery({ queryKey: keys.gateway(), queryFn: api.gateway, enabled })
}

export function useServices() {
  return useQuery({ queryKey: keys.services(), queryFn: api.services })
}

export function useServiceTraefik(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.serviceTraefik(id),
    queryFn: () => api.serviceTraefik(id),
    enabled,
    staleTime: 7_000,
  })
}

export function useDockerHost(enabled = true) {
  return useQuery({ queryKey: keys.dockerHost(), queryFn: api.host, enabled })
}

export function useDockerNetworks(enabled = true) {
  return useQuery({ queryKey: keys.dockerNetworks(), queryFn: api.dockerNetworks, enabled })
}

// Images and volumes read Docker's disk usage, which can take seconds on a big
// host: they are fetched when the page opens, not on a timer.
export function useDockerImages(enabled = true) {
  return useQuery({ queryKey: keys.dockerImages(), queryFn: api.dockerImages, enabled })
}

export function useDockerVolumes(enabled = true) {
  return useQuery({ queryKey: keys.dockerVolumes(), queryFn: api.dockerVolumes, enabled })
}

export function useDockerUsage(enabled = true) {
  return useQuery({ queryKey: keys.dockerUsage(), queryFn: api.dockerUsage, enabled })
}

export function useContainers(filters: { ownership?: string; state?: string; q?: string } = {}, enabled = true) {
  return useQuery({ queryKey: keys.containers(filters), queryFn: () => api.containers(filters), enabled })
}

export function useContainerRemovalPreview(id: string, enabled: boolean) {
  return useQuery({ queryKey: keys.containerRemovalPreview(id), queryFn: () => api.removalPreview(id), enabled })
}

export function useNetwork(enabled = true) {
  return useQuery({ queryKey: keys.network(), queryFn: api.network, enabled })
}

export function useAccess(enabled = true) {
  return useQuery({ queryKey: keys.access(), queryFn: api.access, enabled })
}

export function useServiceConnection(project: string, service: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.connection(project, service),
    queryFn: () => api.serviceConnection(project, service),
    enabled,
  })
}

export function useExposure(enabled = true) {
  return useQuery({ queryKey: keys.exposure(), queryFn: api.exposure, enabled })
}

export function useCrawlers(enabled = true) {
  return useQuery({ queryKey: keys.crawlers(), queryFn: api.crawlers, enabled })
}

export function useProjectCrawlers(slug: string, enabled = true) {
  return useQuery({ queryKey: keys.projectCrawlers(slug), queryFn: () => api.projectCrawlers(slug), enabled })
}

export function useShares(enabled = true) {
  return useQuery({ queryKey: keys.shares(), queryFn: api.shares, enabled })
}

export function useConfig(enabled = true) {
  return useQuery({ queryKey: keys.config(), queryFn: api.config, enabled })
}

/** The collector writes every five seconds; the panel reads at the same pace. */
export function useMetricsCurrent(enabled = true) {
  return useQuery({ queryKey: keys.metricsCurrent(), queryFn: api.metricsCurrent, refetchInterval: 5_000, enabled })
}

export function useMetricsHistory(window = '30m') {
  return useQuery({
    queryKey: keys.metricsHistory(window),
    queryFn: () => api.metricsHistory(window),
    refetchInterval: 15_000,
  })
}

export function useEnvironmentReport(enabled = true) {
  return useQuery({
    queryKey: keys.environmentReport(),
    queryFn: api.environmentReport,
    refetchInterval: 60_000,
    enabled,
  })
}

export function useHostSecurityReport() {
  return useQuery({ queryKey: keys.hostSecurityReport(), queryFn: api.hostSecurityReport, refetchInterval: 60_000 })
}
