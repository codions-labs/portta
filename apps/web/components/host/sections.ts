// The sections Host is made of.
//
// One list, read by the tabs and by the page that picks where somebody lands,
// so the two can never disagree about what a person may open.

export type HostSectionId = 'health' | 'containers' | 'images' | 'volumes' | 'network' | 'gateway' | 'maintenance'

export interface HostSection {
  id: HostSectionId
  href: string
  permission: string
}

export const HOST_SECTIONS: HostSection[] = [
  { id: 'health', href: '/host', permission: 'metrics:read' },
  { id: 'containers', href: '/host/containers', permission: 'docker:read' },
  { id: 'images', href: '/host/images', permission: 'docker:read' },
  { id: 'volumes', href: '/host/volumes', permission: 'docker:read' },
  { id: 'network', href: '/host/network', permission: 'gateway:read' },
  { id: 'gateway', href: '/host/gateway', permission: 'gateway:read' },
  // Only for who may remove: a sweep has nothing to offer a reader.
  { id: 'maintenance', href: '/host/maintenance', permission: 'docker:destroy' },
]

export function visibleHostSections(permissions: readonly string[]): HostSection[] {
  const held = new Set(permissions)
  return HOST_SECTIONS.filter((section) => held.has(section.permission))
}
