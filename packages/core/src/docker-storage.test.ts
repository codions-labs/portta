import { describe, expect, it } from 'vitest'
import { parseDfSize, parseDockerStorage } from './docker-storage.ts'

describe('Docker sizes', () => {
  it('reads what docker prints', () => {
    expect(parseDfSize('418MB')).toBe(418_000_000)
    expect(parseDfSize('12.3kB')).toBe(12_300)
    expect(parseDfSize('0B (virtual 445.7MB)')).toBe(0)
    expect(parseDfSize('1.5GB')).toBe(1_500_000_000)
  })
  it('reads nothing from what is not a size', () => {
    expect(parseDfSize('N/A')).toBeNull()
    expect(parseDfSize(undefined)).toBeNull()
    expect(parseDfSize('12 parsecs')).toBeNull()
  })
})

describe('what a project keeps on the Docker disk', () => {
  const output = JSON.stringify({
    Volumes: [
      { Name: 'shop_db', Labels: 'com.docker.compose.project=shop,com.docker.compose.volume=db', Size: '2GB' },
      { Name: 'shop_cache', Labels: 'com.docker.compose.project=shop', Size: '500MB' },
      { Name: 'anon', Labels: 'com.docker.volume.anonymous=', Size: '9GB' },
      { Name: 'blog_data', Labels: 'com.docker.compose.project=blog', Size: 'N/A' },
    ],
    Containers: [
      { ID: 'a', Labels: 'com.docker.compose.project=shop', Size: '12MB (virtual 300MB)' },
      { ID: 'b', Labels: 'com.docker.compose.project=blog', Size: '1MB (virtual 80MB)' },
      { ID: 'c', Labels: '', Size: '5GB' },
    ],
  })

  it('adds up volumes and writable layers by Compose project, largest first', () => {
    expect(parseDockerStorage(output, 10)).toEqual({
      collectedAt: 10,
      projects: [
        { composeProject: 'shop', volumeBytes: 2_500_000_000, layerBytes: 12_000_000 },
        { composeProject: 'blog', volumeBytes: 0, layerBytes: 1_000_000 },
      ],
    })
  })
  it('says nothing for output that is not the report', () => {
    expect(parseDockerStorage('not json', 1)).toBeNull()
    expect(parseDockerStorage('[]', 1)).toEqual({ collectedAt: 1, projects: [] })
  })
})
