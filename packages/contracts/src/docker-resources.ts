// What the Host area shows and cleans: Docker networks, images and volumes, and
// the prune that sweeps what nothing uses. Every row says by itself whether it
// may be removed and why not, so the UI never has to guess and the server never
// has to trust the UI's guess.

import { z } from 'portta-core/zod'

const named = <T extends z.ZodType>(schema: T, ref: string): T => schema.meta({ ref }) as T

export const DockerResourceKind = named(
  z.enum(['container', 'network', 'image', 'volume']).describe('A kind of Docker resource the panel can clean'),
  'DockerResourceKind',
)
export type DockerResourceKind = z.infer<typeof DockerResourceKind>

export const DockerProtection = named(
  z
    .enum(['portta', 'docker', 'in-use'])
    .describe(
      'Why a resource may not be removed: it belongs to Portta, it is one of Docker’s own defaults, or something still uses it',
    ),
  'DockerProtection',
)
export type DockerProtection = z.infer<typeof DockerProtection>

const protection = DockerProtection.nullable().describe('Null when the resource may be removed')

export const DockerNetworkItem = named(
  z
    .object({
      id: z.string(),
      name: z.string(),
      driver: z.string(),
      scope: z.string(),
      internal: z.boolean(),
      /** Containers that reference the network, running or not. */
      containerCount: z.number().int(),
      role: z.enum(['shared', 'control', 'access', 'project', 'other']),
      project: z.string().nullable().describe('The Compose project that created it, when there is one'),
      protection,
    })
    .strict(),
  'DockerNetworkItem',
)
export type DockerNetworkItem = z.infer<typeof DockerNetworkItem>

export const DockerNetworkList = named(z.object({ networks: z.array(DockerNetworkItem) }).strict(), 'DockerNetworkList')
export type DockerNetworkList = z.infer<typeof DockerNetworkList>

export const DockerImageItem = named(
  z
    .object({
      id: z.string().describe('Image id without the sha256: prefix'),
      tags: z.array(z.string()),
      dangling: z.boolean().describe('No tag points at it any more'),
      sizeBytes: z.number().describe('The whole image, shared layers included'),
      uniqueBytes: z.number().nullable().describe('What removing it would free: the layers no other image shares'),
      createdAt: z.number().describe('Unix timestamp in seconds'),
      containerCount: z.number().int().describe('Containers created from it, running or not'),
      protection,
    })
    .strict(),
  'DockerImageItem',
)
export type DockerImageItem = z.infer<typeof DockerImageItem>

export const DockerImageList = named(
  z
    .object({
      images: z.array(DockerImageItem),
      /** Every layer once: shared layers are not counted per image. */
      totalBytes: z.number(),
      reclaimableBytes: z.number().describe('Unique size of the images nothing uses and the panel may remove'),
    })
    .strict(),
  'DockerImageList',
)
export type DockerImageList = z.infer<typeof DockerImageList>

export const DockerVolumeItem = named(
  z
    .object({
      name: z.string(),
      driver: z.string(),
      sizeBytes: z.number().nullable().describe('Null when the driver does not report a size'),
      createdAt: z.number().nullable().describe('Unix timestamp in seconds'),
      containerCount: z.number().int().describe('Containers that mount it, running or not'),
      anonymous: z.boolean().describe('Docker named it: a container asked for a volume without naming one'),
      project: z.string().nullable().describe('The Compose project that created it, when there is one'),
      protection,
    })
    .strict(),
  'DockerVolumeItem',
)
export type DockerVolumeItem = z.infer<typeof DockerVolumeItem>

export const DockerVolumeList = named(
  z
    .object({
      volumes: z.array(DockerVolumeItem),
      totalBytes: z.number(),
      reclaimableBytes: z.number().describe('Size of the volumes nothing mounts and the panel may remove'),
    })
    .strict(),
  'DockerVolumeList',
)
export type DockerVolumeList = z.infer<typeof DockerVolumeList>

/** What the maintenance view reads before anybody asks for a prune. */
export const DockerDiskUsage = named(
  z
    .object({
      containers: z.object({
        total: z.number().int(),
        stopped: z.number().int().describe('Stopped containers the panel may remove'),
      }),
      networks: z.object({
        total: z.number().int(),
        unused: z.number().int().describe('Networks nothing references that the panel may remove'),
      }),
      images: z.object({
        total: z.number().int(),
        totalBytes: z.number(),
        dangling: z.number().int(),
        danglingBytes: z.number(),
        unused: z.number().int(),
        unusedBytes: z.number(),
      }),
      volumes: z.object({
        total: z.number().int(),
        totalBytes: z.number(),
        anonymous: z.number().int(),
        anonymousBytes: z.number(),
        unused: z.number().int(),
        unusedBytes: z.number(),
      }),
      buildCacheBytes: z.number().describe('Reported only: cleaning it needs the Docker CLI on the host'),
    })
    .strict(),
  'DockerDiskUsage',
)
export type DockerDiskUsage = z.infer<typeof DockerDiskUsage>

export const DockerResourceRemoveBody = named(
  z
    .object({
      confirm: z.literal(true),
      ids: z.array(z.string().min(1).max(256)).min(1).max(500),
    })
    .strict(),
  'DockerResourceRemoveBody',
)
export type DockerResourceRemoveBody = z.infer<typeof DockerResourceRemoveBody>

export const DockerResourceOutcome = named(
  z
    .object({
      kind: DockerResourceKind,
      id: z.string(),
      name: z.string(),
      ok: z.boolean(),
      /** Refused before Docker was asked: it is protected or no longer there. */
      skipped: z.boolean(),
      reason: z.string().nullable(),
      sizeBytes: z.number().nullable(),
    })
    .strict(),
  'DockerResourceOutcome',
)
export type DockerResourceOutcome = z.infer<typeof DockerResourceOutcome>

export const DockerResourceRemoveResult = named(
  z
    .object({
      removed: z.number().int(),
      failed: z.number().int(),
      skipped: z.number().int(),
      freedBytes: z.number(),
      results: z.array(DockerResourceOutcome),
    })
    .strict(),
  'DockerResourceRemoveResult',
)
export type DockerResourceRemoveResult = z.infer<typeof DockerResourceRemoveResult>

export const DockerPruneBody = named(
  z
    .object({
      confirm: z.literal(true),
      /** True lists what would go and removes nothing. */
      dryRun: z.boolean(),
      /** The `kind:id` of each item a preview listed. A real run removes only these; it is required there. */
      candidates: z.array(z.string().max(300)).max(5000).optional(),
      containers: z.boolean().describe('Stopped containers that are not Portta components'),
      networks: z.boolean().describe('Networks no container references'),
      images: z
        .enum(['none', 'dangling', 'unused'])
        .describe('`dangling` is untagged images; `unused` is every image no container was created from'),
      volumes: z
        .enum(['none', 'anonymous', 'unused'])
        .describe(
          '`anonymous` is the volumes Docker named for a container; `unused` also takes named volumes nothing mounts, which is where databases live',
        ),
    })
    .strict(),
  'DockerPruneBody',
)
export type DockerPruneBody = z.infer<typeof DockerPruneBody>

export const DockerPruneResult = named(
  z
    .object({
      dryRun: z.boolean(),
      removed: z.number().int(),
      failed: z.number().int(),
      freedBytes: z.number(),
      items: z.array(DockerResourceOutcome),
    })
    .strict(),
  'DockerPruneResult',
)
export type DockerPruneResult = z.infer<typeof DockerPruneResult>
