// Put this checkout's `portta` on PATH for local testing: a symlink to
// bin/portta, which rebuilds the CLI when its sources change and targets this
// checkout. Unlike `npm link`, it survives a Node version switch and never runs
// a stale dist. Idempotent, and it never replaces a `portta` it did not create.
//
//   link [--soft]   create the link, then verify it (--soft: warn, never fail)
//   verify          only verify
//   unlink          remove the link, if it is this checkout's
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = join(root, 'bin/portta')
const directory = resolve(process.env.PORTTA_LINK_DIR || join(homedir(), '.local/bin'))
const link = join(directory, 'portta')
const [action = 'link', ...flags] = process.argv.slice(2)
const soft = flags.includes('--soft')
if (!['link', 'verify', 'unlink'].includes(action) || flags.some((flag) => flag !== '--soft')) {
  throw new Error('usage: link-cli.mjs link [--soft] | verify | unlink')
}
if (!existsSync(target)) throw new Error(`missing ${target}`)

function current() {
  try {
    return lstatSync(link).isSymbolicLink() ? resolve(directory, readlinkSync(link)) : 'not a symlink'
  } catch {
    return undefined
  }
}

/** The first `portta` a shell would run, ignoring this repository's node_modules/.bin. */
function fromPath() {
  const local = join(root, 'node_modules/.bin')
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry || resolve(entry) === local) continue
    const candidate = join(entry, 'portta')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function describe(path) {
  return lstatSync(path).isSymbolicLink() ? `${path} -> ${realpathSync(path)}` : path
}

/** Why the linked command is not what `portta` runs, or undefined when it is. */
function verify() {
  const resolved = fromPath()
  if (!resolved) return `portta is not on PATH; add ${directory} to PATH`
  if (realpathSync(resolved) !== realpathSync(target))
    return `portta on PATH is ${describe(resolved)}, not this checkout; it comes before ${directory}`
  const expected = `portta ${JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version}`
  const outside = mkdtempSync(join(tmpdir(), 'portta-cli-link-'))
  try {
    const result = spawnSync(resolved, ['--version'], { cwd: outside, encoding: 'utf8' })
    if (result.status !== 0 || !`${result.stdout.trim()} `.startsWith(`${expected} `)) {
      return `portta --version outside the repository failed: ${(result.stderr || result.stdout).trim() || `exit ${result.status}`}`
    }
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
  return undefined
}

function finish({ quiet = false } = {}) {
  const problem = verify()
  if (!problem) {
    if (!quiet) console.log('portta link verified outside the repository')
    return
  }
  console.warn(problem)
  if (!soft) process.exitCode = 1
}

const existing = current()
if (action === 'unlink') {
  if (existing === target) {
    unlinkSync(link)
    console.log(`removed ${link}`)
  } else if (existing !== undefined) {
    console.warn(`not removing ${link}: it does not point at this checkout (${existing})`)
  }
} else if (action === 'verify') {
  finish()
} else if (existing === target) {
  // `just dev` runs this every time: stay silent unless something is wrong.
  finish({ quiet: soft })
} else if (existing !== undefined) {
  console.warn(`not linking portta: ${link} already exists (${existing}); remove it or set PORTTA_LINK_DIR`)
  if (!soft) process.exitCode = 1
} else {
  mkdirSync(directory, { recursive: true })
  symlinkSync(target, link)
  console.log(`linked ${link} -> ${target}`)
  finish()
}
