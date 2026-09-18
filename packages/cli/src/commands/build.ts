import { join } from 'node:path'
import type { Command } from 'commander'
import { porttaImages } from 'portta-core'
import { gatewayContext } from '../context.js'
import { requireDocker } from '../docker.js'
import { Output } from '../output.js'
import { runProcess } from '../process.js'

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean; profile?: string }
}

export interface ImageBuild {
  image: string
  args: string[]
}

export function localReleaseBuilds(root: string, version: string): ImageBuild[] {
  const images = porttaImages(version)
  return [
    {
      image: images.runtime,
      args: [
        'build',
        '--build-arg',
        `PORTTA_VERSION=${version}`,
        '--target',
        'runtime',
        '-f',
        'apps/web/Dockerfile',
        '-t',
        images.runtime,
        '.',
      ],
    },
    {
      image: images.apply,
      args: [
        'build',
        '--build-arg',
        `PORTTA_VERSION=${version}`,
        '-t',
        images.apply,
        join(root, 'docker', 'images', 'apply'),
      ],
    },
    {
      image: images.toolbox,
      args: [
        'build',
        '--build-arg',
        `PORTTA_VERSION=${version}`,
        '-t',
        images.toolbox,
        join(root, 'docker', 'images', 'toolbox'),
      ],
    },
  ]
}

export async function buildCommand(command: Command): Promise<void> {
  const context = gatewayContext({ profile: globals(command).profile })
  const output = new Output(globals(command))
  await requireDocker()
  const builds = localReleaseBuilds(context.root, context.version)
  output.step(`local release ${context.version}`)
  for (const build of builds) {
    output.progress(`building ${build.image}`)
    await runProcess('docker', build.args, { cwd: context.root, stdio: 'inherit' })
  }
  if (globals(command).json) output.data({ version: context.version, images: builds.map(({ image }) => image) })
  else for (const { image } of builds) output.progress(`ready    ${image}`)
}
