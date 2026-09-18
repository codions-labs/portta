import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const root = resolve(import.meta.dirname, '../..')
const runId = `${Date.now()}-${process.pid}`
export const reportDir = resolve(root, 'test-results', runId)
let counter = 0

export async function runStep(label, command, args = [], options = {}) {
  mkdirSync(reportDir, { recursive: true })
  const stem = `${++counter}-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const log = join(reportDir, `${stem}.log`)
  const json = join(reportDir, `${stem}.json`)
  const started = performance.now()
  const actual = options.vitest ? [...args, '--reporter=json', `--outputFile=${json}`] : args
  console.log(`\n== ${label} ==`)
  let output = ''
  writeFileSync(log, '')
  const recordOutput = (data) => {
    output += data
    appendFileSync(log, data)
  }
  const code = await new Promise((done) => {
    const child = spawn(command, actual, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', recordOutput)
    child.stderr.on('data', recordOutput)
    child.on('error', (error) => {
      output += `${error.message}\n`
      done(1)
    })
    child.on('close', (status) => done(status ?? 1))
    const forward = () => child.kill('SIGTERM')
    process.once('SIGTERM', forward)
    process.once('SIGINT', forward)
    child.once('close', () => {
      process.removeListener('SIGTERM', forward)
      process.removeListener('SIGINT', forward)
    })
  })
  let passed = code === 0
  let tests
  if (options.vitest && passed) {
    try {
      const result = JSON.parse(readFileSync(json, 'utf8'))
      tests = result.numPassedTests + result.numFailedTests
      passed = tests > 0 && result.success
      if (!tests) output += '\nNo tests executed: this is not a successful validation.\n'
    } catch (error) {
      passed = false
      output += `\nMissing/invalid Vitest report: ${error.message}\n`
    }
  }
  const skips = output.split('\n').filter((line) => /^\s*skip\s/i.test(line))
  writeFileSync(log, output)
  const record = {
    label,
    command: [command, ...actual],
    seconds: +((performance.now() - started) / 1000).toFixed(3),
    status: passed ? 'passed' : 'failed',
    tests,
    skips,
    log,
  }
  appendFileSync(join(reportDir, 'steps.jsonl'), `${JSON.stringify(record)}\n`)
  console.log(
    `${record.status}: ${record.seconds}s${tests === undefined ? '' : `; ${tests} tests`}${skips.length ? `; ${skips.length} conditional skips (see log)` : ''}`,
  )
  if (!passed) console.error(output)
  return passed
}
