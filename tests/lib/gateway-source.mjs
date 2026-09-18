import { execFileSync } from 'node:child_process'

function gitFiles(root, arguments_) {
  return execFileSync('git', [...arguments_, '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

const privateRuntimePath = /^(docs\/research\/|\.env$|state\/|config\/tls\/)/

/**
 * Files copied into the disposable gateway host.
 *
 * Tracked dynamic configuration is product source and must reach the host.
 * Untracked files in the same directory are runtime output and may contain
 * generated credentials, so they stay on the developer machine.
 */
export function gatewaySourceFiles(root) {
  const tracked = gitFiles(root, ['ls-files', '--cached']).filter((file) => !privateRuntimePath.test(file))
  const untracked = gitFiles(root, ['ls-files', '--others', '--exclude-standard']).filter(
    (file) => !privateRuntimePath.test(file) && !file.startsWith('config/traefik/dynamic/'),
  )
  return [...new Set([...tracked, ...untracked])]
}
