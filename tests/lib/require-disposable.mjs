import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'

try {
  const owner = JSON.parse(readFileSync('/run/portta-e2e-owner.json', 'utf8'))
  const daemon = execFileSync('docker', ['info', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim()
  if (!owner.id || owner.id !== daemon || realpathSync(process.cwd()) !== owner.root)
    throw new Error('Daemon/checkout does not belong to this E2E invocation')
} catch (error) {
  console.error(
    `Gateway E2E requires an owned disposable daemon. Use npm run test:e2e -- --suite NAME. ${error.message}`,
  )
  process.exit(1)
}
