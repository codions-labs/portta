'use client'

import type { ContainerSummary } from 'portta-contracts'
import { httpPortHint } from 'portta-core/browser'
import { useTranslation } from 'react-i18next'
import { containerPortsFor } from '../lib/services.ts'
import { Mono } from './copy.tsx'

/** Ports inside the container, followed separately by any published host ports. */
export function ServicePorts({ container }: { container: ContainerSummary }) {
  const { t } = useTranslation('services', { keyPrefix: 'ports' })
  const ports = containerPortsFor(container)
  if (ports.length === 0) return null
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-medium text-muted">{t('title')}</p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {ports.map(({ port, protocol }) => (
            <li key={`${port}/${protocol}`}>
              <Mono kind="text" tone="ink">
                {port}/{protocol}
              </Mono>
              {protocol === 'tcp' && httpPortHint(container.image, port) === 'http' ? (
                <span className="ml-1.5 text-subtle">HTTP</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {container.ports.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted">{t('published')}</p>
          {container.ports.map((port) => (
            <p key={`${port.ip}:${port.hostPort}/${port.protocol}`} className="font-mono text-xs text-subtle">
              {port.ip}:{port.hostPort} → {port.containerPort}/{port.protocol}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
