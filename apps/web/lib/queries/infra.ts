'use client'

import { useQuery } from '@tanstack/react-query'
import type { Overview } from 'portta-contracts'
import { api } from '../api/index.ts'
import { keys } from './keys.ts'

export function useStatus(initialData?: Overview) {
  return useQuery({ queryKey: keys.status(), queryFn: api.overview, ...(initialData ? { initialData } : {}) })
}

export function useGateway() {
  return useQuery({ queryKey: keys.gateway(), queryFn: api.gateway })
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

export function useDockerHost() {
  return useQuery({ queryKey: keys.dockerHost(), queryFn: api.host })
}

export function useContainers(filters: { ownership?: string; state?: string; q?: string } = {}) {
  return useQuery({ queryKey: keys.containers(filters), queryFn: () => api.containers(filters) })
}

export function useContainerRemovalPreview(id: string, enabled: boolean) {
  return useQuery({ queryKey: keys.containerRemovalPreview(id), queryFn: () => api.removalPreview(id), enabled })
}

export function useNetwork() {
  return useQuery({ queryKey: keys.network(), queryFn: api.network })
}

export function useAccess() {
  return useQuery({ queryKey: keys.access(), queryFn: api.access })
}

export function useServiceConnection(project: string, service: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.connection(project, service),
    queryFn: () => api.serviceConnection(project, service),
    enabled,
  })
}

export function useShares() {
  return useQuery({ queryKey: keys.shares(), queryFn: api.shares })
}

export function useConfig() {
  return useQuery({ queryKey: keys.config(), queryFn: api.config })
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

export function useEnvironmentReport() {
  return useQuery({ queryKey: keys.environmentReport(), queryFn: api.environmentReport, refetchInterval: 60_000 })
}

export function useHostSecurityReport() {
  return useQuery({ queryKey: keys.hostSecurityReport(), queryFn: api.hostSecurityReport, refetchInterval: 60_000 })
}

export function useSshKeys() {
  return useQuery({ queryKey: keys.sshKeys(), queryFn: api.sshKeys })
}
