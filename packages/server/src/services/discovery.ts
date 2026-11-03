// The project folders the collector found and what adopting each would do, read from where it
// published them. The panel never opens Projects Home: it reads state/discovery/ and answers only
// for a folder that is in the collector's own list, so a path from a request is never opened.

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { type DiscoveredFolders, type FolderPlan, fileKey, isDiscoverablePath } from 'portta-core'
import { z } from 'portta-core/zod'
import type { PanelConfig } from '../config.ts'

const Folder = z.object({
  path: z.string(),
  composeFile: z.string(),
  services: z.number().nullable(),
  modifiedAt: z.number(),
  adopted: z.boolean(),
  planned: z.boolean(),
})
const Index = z.object({
  version: z.literal(1),
  home: z.string(),
  collectedAt: z.number(),
  folders: z.array(Folder),
})
const Plan = z.object({
  version: z.literal(1),
  path: z.string(),
  composeFile: z.string(),
  project: z.object({ name: z.string(), source: z.string() }),
  domain: z.string(),
  adopted: z.boolean(),
  services: z.array(
    z.object({
      name: z.string(),
      image: z.string().nullable(),
      kind: z.string(),
      port: z.string().nullable(),
      publishedPorts: z.array(z.object({ host: z.string(), container: z.string() })),
      containerName: z.string().nullable(),
    }),
  ),
  findings: z.object({
    publishedHostPorts: z.array(z.string()),
    fixedContainerNames: z.array(z.string()),
    publishedDatastores: z.array(z.string()),
    implicitNamespace: z.boolean(),
    containerNameCollisions: z.array(z.object({ service: z.string(), containerName: z.string(), usedBy: z.string() })),
    namespaceInUse: z.object({ project: z.string(), workingDirs: z.array(z.string()) }).nullable(),
  }),
  collectedAt: z.number(),
})

function readSmall(path: string, limit: number): string | null {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    return null
  }
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > limit) return null
    const buffer = Buffer.alloc(info.size)
    return buffer.subarray(0, readSync(fd, buffer, 0, info.size, 0)).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

export function readDiscoveredFolders(config: PanelConfig): DiscoveredFolders | null {
  const text = readSmall(join(config.discoveryDir, 'folders.json'), 4 * 1024 * 1024)
  if (text === null) return null
  try {
    const parsed = Index.safeParse(JSON.parse(text))
    if (!parsed.success) return null
    // A path the index should never have held is dropped here as well.
    return { ...parsed.data, folders: parsed.data.folders.filter((folder) => isDiscoverablePath(folder.path)) }
  } catch {
    return null
  }
}

/** Null unless the folder is one the collector listed and published a plan for. */
export function readFolderPlan(config: PanelConfig, path: string): FolderPlan | null {
  if (!isDiscoverablePath(path)) return null
  const listed = readDiscoveredFolders(config)?.folders.find((folder) => folder.path === path)
  if (!listed?.planned) return null
  const text = readSmall(join(config.discoveryDir, 'plans', fileKey(path)), 1024 * 1024)
  if (text === null) return null
  try {
    const parsed = Plan.safeParse(JSON.parse(text))
    return parsed.success && parsed.data.path === path ? parsed.data : null
  } catch {
    return null
  }
}
